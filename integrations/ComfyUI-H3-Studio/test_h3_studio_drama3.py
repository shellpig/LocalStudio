import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import AsyncMock, patch

import aiohttp
from aiohttp import web


def import_bridge(root):
    package = types.ModuleType("drama_test")
    package.__path__ = []
    api = types.ModuleType("drama_test.h3_studio_api")
    api.STUDIO_ORIGINS = {"http://localhost:3000"}
    api.metadata_path_for = lambda path: path.with_suffix(path.suffix + ".h3.json")
    api.load_metadata = lambda path: json.loads(api.metadata_path_for(path).read_text(encoding="utf-8")) if api.metadata_path_for(path).exists() else {}
    paths = types.ModuleType("folder_paths")
    paths.get_output_directory = lambda: str(root)
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(
        routes=web.RouteTableDef(), app=web.Application(), prompt_queue=types.SimpleNamespace(get_tasks_remaining=lambda: 0)))
    with patch.dict(sys.modules, {"drama_test": package, "drama_test.h3_studio_api": api, "folder_paths": paths, "server": server}):
        spec = importlib.util.spec_from_file_location("drama_test.bridge", Path(__file__).with_name("h3_studio_drama3.py"))
        bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bridge)
    return bridge


def settings():
    return {"roles": [{"id": "a", "name": "Alice", "voice": "a.safetensors"},
                      {"id": "b", "name": "Bob", "voice": "b.safetensors"}],
            "lines": [{"roleId": "b", "text": "Hello Alice."}, {"roleId": "a", "text": "Hi Bob. [laughs]"}], "seed": 42}


class DialogueTests(unittest.TestCase):
    def setUp(self):
        self.bridge = import_bridge(Path(tempfile.gettempdir()))

    def test_dialogue_preserves_order_and_binds_all_speakers(self):
        data = self.bridge.validate_dialogue(settings(), ["a.safetensors", "b.safetensors"])
        graph = self.bridge.dialogue_graph(data, "test")
        self.assertEqual(graph["3"]["inputs"]["text"], "<|speaker:1|> Hello Alice.\n<|speaker:0|> Hi Bob. [laughs]")
        self.assertEqual(graph["101"]["inputs"]["speaker"], 0)
        self.assertEqual(graph["103"]["inputs"]["speaker"], 1)
        self.assertEqual(graph["3"]["inputs"]["voices.voice1"], ["103", 0])
        self.assertEqual(graph["3"]["inputs"]["seed"], 42)
        self.assertEqual(graph["3"]["inputs"]["max_frames"], 1290)
        self.assertTrue(graph["3"]["inputs"]["split_long_text"])

    def test_invalid_roles_scripts_and_parameters_fail(self):
        cases = [{"roles": []}, {"roles": settings()["roles"] * 9}, {"lines": []}, {"seed": True}, {"seed": -1},
                 {"temperature": float("nan")}, {"topP": 0}, {"topK": 1.5}, {"maxFrames": 8193},
                 {"lines": [{"roleId": "a", "text": "<|speaker:1|> hijack"}]},
                 {"lines": [{"roleId": "absent", "text": "hello"}]},
                 {"roles": [settings()["roles"][0]] * 2},
                 {"lines": [{"roleId": "a", "text": "x" * 2000}] * 7}]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(ValueError):
                self.bridge.validate_dialogue({**settings(), **case}, ["a.safetensors", "b.safetensors"])
        with self.assertRaises(ValueError):
            self.bridge.validate_dialogue(settings(), [])

    def test_all_16_speakers_and_shared_voice_are_supported(self):
        roles = [{"id": str(i), "name": f"role {i}", "voice": "same.safetensors"} for i in range(16)]
        data = self.bridge.validate_dialogue({"roles": roles, "lines": [{"roleId": "15", "text": "Hello"}]}, ["same.safetensors"])
        graph = self.bridge.dialogue_graph(data, "test")
        self.assertIn("voices.voice15", graph["3"]["inputs"])
        self.assertEqual(graph["131"]["inputs"]["speaker"], 15)

    def test_voice_reassignment_does_not_mutate_saved_reference(self):
        spec = importlib.util.spec_from_file_location("speaker_node", Path(__file__).parents[1] / "ComfyUI-Drama3-Studio/__init__.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"folder_paths": self.bridge.folder_paths, "server": types.SimpleNamespace(PromptServer=self.bridge.PromptServer)}):
            spec.loader.exec_module(module)
        saved = {"transcript": "<|speaker:0|> Hello", "codes": object()}
        assigned, = module.Drama3StudioSpeaker().assign(saved, 7)
        self.assertEqual(assigned["transcript"], "<|speaker:7|> Hello")
        self.assertEqual(saved["transcript"], "<|speaker:0|> Hello")
        self.assertIs(assigned["codes"], saved["codes"])
        self.assertIs(module.Drama3StudioVoiceCodes().extract(saved)[0], saved["codes"])
        for text in ("", "<|speaker:0|>", "hello <|speaker:1|> other"):
            with self.assertRaises(ValueError):
                module.Drama3StudioSpeaker().assign({"transcript": text}, 0)


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.bridge = import_bridge(self.root)
        self.voices = ["a.safetensors", "b.safetensors"]
        self.graph = None
        self.interrupted = False
        self.pending = False
        self.hold_prompt = False
        self.runtime_root = str(self.bridge.RUNTIME_ROOT)
        upstream = web.Application()
        upstream.router.add_route("*", "/{tail:.*}", self.upstream)
        self.runners = []
        self.bridge.BASE = await self.serve(upstream)
        app = self.bridge.PromptServer.instance.app
        app.add_routes(self.bridge.PromptServer.instance.routes)
        self.url = await self.serve(app)
        self.session = aiohttp.ClientSession(headers={"Origin": "http://localhost:3000"})
        self.release = patch.object(self.bridge, "release_gpu", new=AsyncMock())
        self.release.start()
        self.service = patch.object(self.bridge, "service_action", new=AsyncMock())
        self.service_mock = self.service.start()

    async def serve(self, app):
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        self.runners.append(runner)
        return f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}"

    async def asyncTearDown(self):
        await asyncio.gather(*self.bridge.TASKS, return_exceptions=True)
        self.release.stop()
        self.service.stop()
        await self.session.close()
        for runner in reversed(self.runners):
            await runner.cleanup()
        self.temp.cleanup()

    async def upstream(self, request):
        path = request.path
        if path == "/drama3-studio/runtime":
            return web.json_response({"comfyRoot": self.runtime_root})
        if path.endswith("Drama3StudioSpeaker"):
            return web.json_response({"Drama3StudioSpeaker": {}})
        if path.endswith("Drama3StudioVoiceCodes"):
            return web.json_response({"Drama3StudioVoiceCodes": {}})
        if path == "/drama3-studio/voices/open-folder":
            self.assertIn((await request.json())["voice"], self.voices)
            return web.json_response({"folder": "C:\\Drama3\\output\\drama3_voices"})
        if path.endswith("Drama3LoadVoice"):
            return web.json_response({"Drama3LoadVoice": {"input": {"required": {"voice": ["COMBO", {"options": self.voices}]}}}})
        if path == "/queue":
            return web.json_response({"queue_running": [[0, "test-id"]] if self.pending else [], "queue_pending": []})
        if path == "/prompt":
            self.graph = (await request.json())["prompt"]
            self.pending = self.hold_prompt
            if self.graph.get("4", {}).get("class_type") == "Drama3SaveVoice":
                self.voices.append(self.graph["4"]["inputs"]["name"] + "_00001_.safetensors")
            return web.json_response({"prompt_id": "test-id"})
        if path == "/interrupt":
            self.interrupted = True
            self.pending = False
            return web.json_response({})
        if path.startswith("/history/"):
            if self.pending:
                return web.json_response({})
            if self.graph.get("5", {}).get("class_type") == "SaveAudio":
                outputs = {"5": {"audio": [{"filename": "test.flac", "subfolder": "", "type": "output"}]}}
            else:
                outputs = {"4": {"text": ["Hello Alice."]}}
            return web.json_response({"test-id": {"status": {"status_str": "success"}, "outputs": outputs}})
        if path == "/view":
            return web.Response(body=b"fLaCfixture", content_type="audio/flac")
        return web.json_response({})

    async def submit(self, operation, data):
        async with self.session.post(self.url + "/h3-studio/drama3/jobs", json={**data, "operation": operation}) as response:
            self.assertEqual(response.status, 200, await response.text())
            return await response.json()

    async def test_generate_import_list_download_and_metadata(self):
        submitted = await self.submit("generate", settings())
        await asyncio.gather(*self.bridge.TASKS)
        job = self.bridge.JOBS[submitted["id"]]
        self.assertEqual(job["status"], "completed", job)
        items = self.bridge.list_audio(self.root)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["drama3"]["lines"], settings()["lines"])
        self.assertEqual(items[0]["seed"], 42)
        async with self.session.get(self.url + "/h3-studio/drama3/download", params={"filename": items[0]["filename"]}) as response:
            self.assertEqual(await response.read(), b"fLaCfixture")
        async with self.session.get(self.url + "/h3-studio/drama3/download?filename=../secret.flac") as response:
            self.assertEqual(response.status, 400)

    async def test_transcribe_save_and_voice_library(self):
        reference = "H3_Drama3_ref_" + "a" * 32 + ".wav"
        job = await self.submit("transcribe", {"reference": reference, "language": "English"})
        await asyncio.gather(*self.bridge.TASKS)
        self.assertEqual(self.bridge.JOBS[job["id"]]["result"], {"transcript": "Hello Alice."})
        job = await self.submit("saveVoice", {"reference": reference, "name": "Alice", "transcript": "Hello Alice."})
        await asyncio.gather(*self.bridge.TASKS)
        saved = self.bridge.JOBS[job["id"]]["result"]["voice"]
        async with self.session.get(self.url + "/h3-studio/drama3/status") as response:
            status = await response.json()
        self.assertTrue(status["ready"])
        self.assertIn(saved, status["voices"])

    async def test_voice_preview_decodes_reference_codes_and_is_not_a_work(self):
        job = await self.submit("previewVoice", {"voice": "a.safetensors"})
        await asyncio.gather(*self.bridge.TASKS)
        completed = self.bridge.JOBS[job["id"]]
        self.assertEqual(completed["status"], "completed", completed)
        self.assertEqual(self.graph["2"]["class_type"], "Drama3StudioVoiceCodes")
        self.assertFalse(any(n["class_type"] == "Drama3Generate" for n in self.graph.values()))
        key = completed["result"]["previewKey"]
        async with self.session.get(self.url + "/h3-studio/drama3/voices/preview/" + key) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.read(), b"fLaCfixture")
        self.assertEqual(self.bridge.list_audio(self.root), [])
        async with self.session.get(self.url + "/h3-studio/drama3/voices/preview/not-a-key") as response:
            self.assertEqual(response.status, 400)

    async def test_open_folder_forwards_only_known_voice(self):
        with patch.object(self.bridge, "local_voice_names", return_value=self.voices), \
             patch.object(self.bridge.os, "startfile", create=True) as launch:
            async with self.session.post(self.url + "/h3-studio/drama3/voices/open-folder", json={"voice": "a.safetensors"}) as response:
                self.assertEqual(response.status, 200)
                self.assertIn("drama3_voices", (await response.json())["folder"])
            launch.assert_called_once()
            async with self.session.post(self.url + "/h3-studio/drama3/voices/open-folder", json={"voice": "../secret"}) as response:
                self.assertEqual(response.status, 400)

    async def test_folder_node_opens_resolved_voice_directory(self):
        spec = importlib.util.spec_from_file_location("voice_files_node", Path(__file__).parents[1] / "ComfyUI-Drama3-Studio/__init__.py")
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"folder_paths": self.bridge.folder_paths, "server": types.SimpleNamespace(PromptServer=self.bridge.PromptServer)}):
            spec.loader.exec_module(module)
        voice = self.root / "saved.safetensors"
        voice.write_bytes(b"fixture")
        request = types.SimpleNamespace(remote="127.0.0.1", headers={}, json=AsyncMock(return_value={"voice": voice.name}))
        with patch.object(module.folder_paths, "get_filename_list", return_value=[voice.name], create=True), \
             patch.object(module.folder_paths, "get_full_path_or_raise", return_value=str(voice), create=True), \
             patch.object(module.os, "startfile", create=True) as launch:
            response = await module.open_voice_folder(request)
            launch.assert_called_once_with(str(self.root.resolve()))
            self.assertEqual(response.status, 200)
            request.json.return_value = {"voice": "../secret"}
            with self.assertRaises(web.HTTPBadRequest):
                await module.open_voice_folder(request)

    async def test_cancellation_holds_admission_until_cleanup_finishes(self):
        # Pause before the prompt so cancellation deterministically reaches wait_history.
        job = {"id": "b" * 32, "operation": "generate", "status": "running", "message": "starting", "cancel": True}
        self.bridge.JOBS[job["id"]] = job
        data = self.bridge.validate_dialogue(settings(), self.voices)
        self.pending = False
        await self.bridge.run_job(job, data)
        self.assertEqual(job["status"], "cancelled")
        self.assertIsNone(self.bridge.active_job())

    async def test_cancels_only_the_submitted_upstream_prompt(self):
        self.hold_prompt = True
        submitted = await self.submit("generate", settings())
        for _ in range(100):
            if self.pending:
                break
            await asyncio.sleep(0.01)
        self.assertTrue(self.pending)
        async with self.session.post(self.url + f"/h3-studio/drama3/jobs/{submitted['id']}/cancel") as response:
            self.assertEqual((await response.json())["status"], "cancelling")
        await asyncio.gather(*self.bridge.TASKS)
        self.assertTrue(self.interrupted)
        self.assertEqual(self.bridge.JOBS[submitted["id"]]["status"], "cancelled")
        self.service_mock.assert_awaited_once_with("Stop")

    async def test_cleanup_is_part_of_the_running_job_and_blocks_video_prompts(self):
        entered, finish = asyncio.Event(), asyncio.Event()
        async def service(action):
            if action == "Stop":
                entered.set()
                await finish.wait()
        self.service_mock.side_effect = service
        submitted = await self.submit("generate", settings())
        await entered.wait()
        self.assertIsNotNone(self.bridge.active_job())
        async with self.session.post(self.url + "/prompt", json={}) as response:
            self.assertEqual(response.status, 409)
        finish.set()
        await asyncio.gather(*self.bridge.TASKS)
        self.assertEqual(self.bridge.JOBS[submitted["id"]]["status"], "completed")

    async def test_every_operation_stops_service_after_saving_result(self):
        reference = "H3_Drama3_ref_" + "a" * 32 + ".wav"
        for operation, data in [("generate", settings()), ("previewVoice", {"voice": "a.safetensors"}),
                                ("transcribe", {"reference": reference, "language": "English"}),
                                ("saveVoice", {"reference": reference, "name": "Alice", "transcript": "Hello"})]:
            with self.subTest(operation=operation):
                self.service_mock.reset_mock()
                async def stop(action):
                    self.assertEqual(action, "Stop")
                    self.assertIn("result", self.bridge.active_job())
                self.service_mock.side_effect = stop
                submitted = await self.submit(operation, data)
                await asyncio.gather(*self.bridge.TASKS)
                self.assertEqual(self.bridge.JOBS[submitted["id"]]["status"], "completed")
                self.service_mock.assert_awaited_once_with("Stop")

    async def test_offline_status_keeps_voices_without_starting_service(self):
        self.bridge.BASE = "http://127.0.0.1:1"
        with patch.object(self.bridge, "runtime_installed", return_value=True), \
             patch.object(self.bridge, "local_voice_names", return_value=self.voices):
            async with self.session.get(self.url + "/h3-studio/drama3/status") as response:
                status = await response.json()
            self.assertTrue(status["ready"])
            self.assertTrue(status["standby"])
            self.assertEqual(status["voices"], self.voices)
            self.service_mock.assert_not_awaited()

    async def test_offline_job_starts_then_stops_and_next_job_can_run(self):
        online = self.bridge.BASE
        self.bridge.BASE = "http://127.0.0.1:1"
        async def service(action):
            self.bridge.BASE = online if action == "Start" else "http://127.0.0.1:1"
        self.service_mock.side_effect = service
        with patch.object(self.bridge, "runtime_installed", return_value=True), \
             patch.object(self.bridge, "local_voice_names", return_value=self.voices):
            for _ in range(2):
                submitted = await self.submit("generate", settings())
                await asyncio.gather(*self.bridge.TASKS)
                self.assertEqual(self.bridge.JOBS[submitted["id"]]["status"], "completed")
        self.assertEqual([call.args[0] for call in self.service_mock.await_args_list], ["Start", "Stop", "Start", "Stop"])

    async def test_failed_generation_stops_service(self):
        with patch.object(self.bridge, "wait_history", side_effect=RuntimeError("generation failed")):
            submitted = await self.submit("generate", settings())
            await asyncio.gather(*self.bridge.TASKS)
        self.assertEqual(self.bridge.JOBS[submitted["id"]]["status"], "failed")
        self.service_mock.assert_awaited_once_with("Stop")

    async def test_failed_start_cleans_up_service(self):
        self.bridge.BASE = "http://127.0.0.1:1"
        async def service(action):
            if action == "Start":
                raise RuntimeError("startup failed")
        self.service_mock.side_effect = service
        with self.assertRaisesRegex(RuntimeError, "startup failed"):
            await self.bridge.start_runtime(self.session)
        self.assertEqual([call.args[0] for call in self.service_mock.await_args_list], ["Start", "Stop"])

    async def test_shutdown_failure_is_reported(self):
        self.service_mock.side_effect = RuntimeError("still running")
        submitted = await self.submit("generate", settings())
        await asyncio.gather(*self.bridge.TASKS)
        job = self.bridge.JOBS[submitted["id"]]
        self.assertEqual(job["status"], "failed")
        self.assertIn("記憶體釋放失敗", job["message"])

    async def test_origin_and_reference_validation(self):
        async with self.session.post(self.url + "/h3-studio/drama3/jobs", json={}, headers={"Origin": "https://example.com"}) as response:
            self.assertEqual(response.status, 403)
        async with self.session.post(self.url + "/h3-studio/drama3/jobs", json={"operation": "saveVoice", "reference": "../../secret.wav"}) as response:
            self.assertEqual(response.status, 400)

    async def test_foreign_runtime_cannot_supply_voices_or_receive_jobs(self):
        self.runtime_root = str(self.root / "another-project" / "ComfyUI")
        async with self.session.get(self.url + "/h3-studio/drama3/status") as response:
            status = await response.json()
            self.assertFalse(status["ready"])
            self.assertEqual(status["voices"], [])
        async with self.session.post(self.url + "/h3-studio/drama3/jobs", json={**settings(), "operation": "generate"}) as response:
            self.assertNotEqual(response.status, 200)
        self.assertIsNone(self.graph)


if __name__ == "__main__":
    unittest.main()
