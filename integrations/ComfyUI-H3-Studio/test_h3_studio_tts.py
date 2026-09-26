import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


HELPER_PATH = Path(__file__).with_name("h3_studio_tts.py")
SPEC = importlib.util.spec_from_file_location("h3_studio_tts", HELPER_PATH)
tts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tts)


class GeminiTtsRequestTests(unittest.TestCase):
    def test_builds_documented_rest_request_with_optional_style(self):
        payload = tts.build_gemini_tts_request({
            "model": "gemini-3.8-flash-tts",
            "voice": "Kore",
            "text": "你好，歡迎使用語音生成。",
            "style": "自然親切",
        })

        self.assertEqual(payload, {
            "model": "gemini-3.8-flash-tts",
            "input": [{
                "type": "user_input",
                "content": [{
                    "type": "text",
                    "text": "你好，歡迎使用語音生成。",
                    "annotations": [{"type": "speech_metadata", "style": "自然親切"}],
                }],
            }],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": "Kore"}]},
        })

    def test_omits_empty_style_annotation_and_accepts_future_voice_ids(self):
        payload = tts.build_gemini_tts_request({
            "model": "gemini-3.8-flash-lite-tts",
            "voice": "voice_future_123",
            "text": "Hello.",
            "style": "   ",
        })

        self.assertEqual(payload["generation_config"]["speech_config"], [{"voice": "voice_future_123"}])
        self.assertNotIn("annotations", payload["input"][0]["content"][0])

    def test_rejects_empty_text_and_unknown_models(self):
        with self.assertRaisesRegex(ValueError, "輸入"):
            tts.build_gemini_tts_request({"model": "gemini-3.8-flash-tts", "voice": "Kore", "text": "  "})
        with self.assertRaisesRegex(ValueError, "模型"):
            tts.build_gemini_tts_request({"model": "other-model", "voice": "Kore", "text": "Hello"})

    def test_rejects_text_longer_than_the_single_request_limit(self):
        with self.assertRaisesRegex(ValueError, "分段生成"):
            tts.build_gemini_tts_request({
                "model": "gemini-3.8-flash-tts",
                "voice": "Kore",
                "text": "字" * (tts.GEMINI_TTS_MAX_TEXT_CHARS + 1),
            })


class GeminiTtsRestResponseTests(unittest.TestCase):
    def test_extracts_last_wav_from_documented_steps_content_data_shape(self):
        first_wav = b"RIFF\x04\x00\x00\x00WAVE"
        final_wav = b"RIFF\x08\x00\x00\x00WAVEdata"
        mocked_rest_response = {
            "steps": [
                {"type": "model_output", "content": [{
                    "type": "audio", "mime_type": "audio/wav", "data": base64.b64encode(first_wav).decode("ascii"),
                }]},
                {"type": "model_output", "content": [
                    {"type": "text", "text": "This text block is ignored."},
                    {"type": "audio", "mime_type": "audio/wav", "data": base64.b64encode(final_wav).decode("ascii")},
                ]},
            ]
        }

        self.assertEqual(tts.extract_gemini_tts_wav(mocked_rest_response), final_wav)

    def test_rejects_invalid_or_non_wav_audio_without_echoing_google_payload(self):
        response = {"steps": [{"type": "model_output", "content": [{"type": "audio", "data": "not-base64"}]}]}
        with self.assertRaisesRegex(ValueError, "解碼"):
            tts.extract_gemini_tts_wav(response)

        response["steps"][0]["content"][0]["data"] = base64.b64encode(b"not-a-wav-file").decode("ascii")
        with self.assertRaisesRegex(ValueError, "WAV"):
            tts.extract_gemini_tts_wav(response)

    def test_http_errors_are_summarized(self):
        message = tts.gemini_tts_http_error(403)
        self.assertIn("金鑰", message)
        self.assertNotIn("secret", message)


class GeminiVoiceLibraryTests(unittest.TestCase):
    def test_builds_official_prebuilt_voice_list_filters_and_page_token(self):
        params = tts.build_gemini_voice_list_params({
            "search": "warm",
            "languageCode": "en-US",
            "gender": "female",
            "pageToken": "next-page-token",
        })
        self.assertEqual(params, [
            ("type", "prebuilt"),
            ("page_size", "50"),
            ("search", "warm"),
            ("language_code", "en-US"),
            ("gender", "female"),
            ("page_token", "next-page-token"),
        ])
        with self.assertRaisesRegex(ValueError, "性別"):
            tts.build_gemini_voice_list_params({"gender": "other"})

    def test_sanitizes_official_voice_response_and_excludes_custom_voice_data(self):
        mock_response = {
            "next_page_token": "next-page-token",
            "voices": [
                {
                    "id": "StudioVoiceA",
                    "display_name": "Studio Voice A",
                    "description": "Warm narration voice.",
                    "gender": "female",
                    "language_code": "en-US",
                    "accent": "American",
                    "type": "prebuilt",
                    "sample_audio": {"data": "sample-data", "mime_type": "audio/wav"},
                    "key": "must-not-be-returned",
                },
                {"id": "voice_custom_123", "display_name": "Custom", "type": "prompted"},
            ],
        }
        sanitized = tts.sanitize_gemini_voice_list_response(mock_response)
        self.assertEqual(sanitized["nextPageToken"], "next-page-token")
        self.assertEqual(len(sanitized["voices"]), 1)
        self.assertEqual(sanitized["voices"][0]["id"], "StudioVoiceA")
        self.assertEqual(sanitized["voices"][0]["languageCode"], "en-US")
        self.assertNotIn("sample_audio", sanitized["voices"][0])
        self.assertNotIn("key", sanitized["voices"][0])


class GeminiTtsPreviewCacheTests(unittest.TestCase):
    def test_preview_uses_a_short_language_matched_request_and_model_voice_ids(self):
        payload, language_code, text = tts.build_gemini_tts_preview_request({
            "model": "gemini-3.8-flash-lite-tts",
            "voice": "StudioVoiceA",
            "languageCode": "zh-TW",
        })
        self.assertEqual(language_code, "zh-tw")
        self.assertEqual(text, tts.GEMINI_TTS_PREVIEW_TEXTS["zh"])
        self.assertEqual(payload["generation_config"]["speech_config"], [{"voice": "StudioVoiceA"}])
        self.assertNotIn("annotations", payload["input"][0]["content"][0])

    def test_cache_keys_include_model_voice_and_language_and_never_create_a_work(self):
        wav = b"RIFF\x04\x00\x00\x00WAVE"
        text = tts.GEMINI_TTS_PREVIEW_TEXTS["en"]
        name = tts.gemini_tts_preview_cache_name("gemini-3.8-flash-tts", "VoiceA", "en-us", text)
        self.assertNotEqual(name, tts.gemini_tts_preview_cache_name("gemini-3.8-flash-lite-tts", "VoiceA", "en-us", text))
        self.assertNotEqual(name, tts.gemini_tts_preview_cache_name("gemini-3.8-flash-tts", "VoiceB", "en-us", text))
        self.assertNotEqual(name, tts.gemini_tts_preview_cache_name("gemini-3.8-flash-tts", "VoiceA", "zh-tw", text))

        with tempfile.TemporaryDirectory() as temporary:
            cache_directory = Path(temporary) / "temp" / "h3_tts_preview_cache"
            output_directory = Path(temporary) / "output"
            tts.write_gemini_tts_preview_cache(cache_directory, name, wav)
            self.assertEqual(tts.read_gemini_tts_preview_cache(cache_directory, name), wav)
            self.assertEqual(tts.list_gemini_tts_audio(output_directory), [])


class GeminiTtsOutputTests(unittest.TestCase):
    def test_saves_each_wav_and_metadata_as_a_separate_work(self):
        wav = b"RIFF\x04\x00\x00\x00WAVE"
        with tempfile.TemporaryDirectory() as output_root:
            first = tts.save_gemini_tts_audio(output_root, wav, "gemini-3.8-flash-tts", "Kore")
            second = tts.save_gemini_tts_audio(output_root, wav, "gemini-3.8-flash-lite-tts", "Puck")

            self.assertNotEqual(first["filename"], second["filename"])
            for item in (first, second):
                self.assertEqual(item["kind"], "audio")
                self.assertEqual(item["subfolder"], "H3_Audio")
                target = Path(output_root) / item["subfolder"] / item["filename"]
                self.assertEqual(target.read_bytes(), wav)
                self.assertEqual(json.loads(target.with_suffix(".wav.h3.json").read_text(encoding="utf-8")), {
                    "model": item["model"], "voice": item["voice"],
                })
            restored = tts.list_gemini_tts_audio(output_root)
            self.assertEqual({item["filename"] for item in restored}, {first["filename"], second["filename"]})
            self.assertEqual({item["voice"] for item in restored}, {"Kore", "Puck"})


if __name__ == "__main__":
    unittest.main()
