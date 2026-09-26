"""Pure request and response helpers for Gemini TTS."""

import base64
import binascii
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import tempfile
import uuid


GEMINI_TTS_MODELS = frozenset({"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"})
GEMINI_TTS_MAX_TEXT_CHARS = 6000
GEMINI_TTS_MAX_STYLE_CHARS = 500
GEMINI_TTS_OUTPUT_SUBFOLDER = "H3_Audio"
GEMINI_TTS_FILENAME = re.compile(r"H3_Studio_TTS_\d{8}_\d{6}_[0-9a-f]{6}\.wav")
GEMINI_VOICE_ID = re.compile(r"[A-Za-z0-9_-]{1,100}")
GEMINI_LANGUAGE_CODE = re.compile(r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*")
GEMINI_TTS_PREVIEW_TEXT_VERSION = "v1"
GEMINI_TTS_PREVIEW_TEXTS = {
    "en": "Hello, this is a short voice preview.",
    "zh": "你好，這是一段聲音試聽。",
    "ja": "こんにちは、音声の試聴です。",
    "ko": "안녕하세요, 목소리 미리듣기입니다.",
    "es": "Hola, esta es una breve prueba de voz.",
    "fr": "Bonjour, ceci est un court aperçu vocal.",
    "de": "Hallo, dies ist eine kurze Stimmprobe.",
    "it": "Ciao, questa è una breve anteprima vocale.",
    "pt": "Olá, esta é uma breve prévia de voz.",
    "hi": "नमस्ते, यह आवाज़ का एक छोटा पूर्वावलोकन है।",
    "ar": "مرحبًا، هذه معاينة صوتية قصيرة.",
    "th": "สวัสดี นี่คือตัวอย่างเสียงสั้น ๆ",
    "ru": "Здравствуйте, это короткий пример голоса.",
    "id": "Halo, ini contoh suara singkat.",
    "tr": "Merhaba, bu kısa bir ses önizlemesi.",
    "nl": "Hallo, dit is een korte stemproef.",
    "vi": "Xin chào, đây là bản nghe thử giọng nói ngắn.",
}


def is_gemini_tts_filename(filename):
    return isinstance(filename, str) and GEMINI_TTS_FILENAME.fullmatch(filename) is not None


def build_gemini_tts_request(data):
    if not isinstance(data, dict):
        raise ValueError("請提供語音生成設定")

    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("請先輸入要朗讀的文字")
    if len(text) > GEMINI_TTS_MAX_TEXT_CHARS:
        raise ValueError(f"文字最多 {GEMINI_TTS_MAX_TEXT_CHARS:,} 個字元，請分段生成")

    model = data.get("model")
    if not isinstance(model, str) or model not in GEMINI_TTS_MODELS:
        raise ValueError("請選擇有效的 Gemini TTS 模型")

    voice = data.get("voice")
    if not isinstance(voice, str) or not voice or len(voice) > 100 or not all(
        character.isascii() and (character.isalnum() or character in "_-") for character in voice
    ):
        raise ValueError("請選擇有效的聲線")

    style = data.get("style", "")
    if not isinstance(style, str):
        raise ValueError("語氣描述格式無效")
    style = style.strip()
    if len(style) > GEMINI_TTS_MAX_STYLE_CHARS:
        raise ValueError(f"語氣描述最多 {GEMINI_TTS_MAX_STYLE_CHARS} 個字元")

    content = {"type": "text", "text": text}
    if style:
        content["annotations"] = [{"type": "speech_metadata", "style": style}]

    return {
        "model": model,
        "input": [{"type": "user_input", "content": [content]}],
        "response_format": {"type": "audio"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }


def build_gemini_voice_list_params(filters):
    if not isinstance(filters, dict):
        raise ValueError("聲線搜尋條件格式無效")

    search = filters.get("search", "")
    if not isinstance(search, str):
        raise ValueError("搜尋文字格式無效")
    search = search.strip()
    if len(search.encode("utf-8")) > 2048:
        raise ValueError("搜尋文字最多 2,048 位元組")

    language_code = filters.get("languageCode", "")
    if not isinstance(language_code, str):
        raise ValueError("語言代碼格式無效")
    language_code = language_code.strip()
    if language_code and not GEMINI_LANGUAGE_CODE.fullmatch(language_code):
        raise ValueError("語言代碼格式無效，例如 en-US 或 zh-TW")

    gender = filters.get("gender", "")
    if not isinstance(gender, str) or gender not in {"", "female", "male", "neutral"}:
        raise ValueError("性別篩選條件無效")

    page_token = filters.get("pageToken", "")
    if not isinstance(page_token, str) or len(page_token) > 4096 or not page_token.isprintable():
        raise ValueError("聲線分頁資料格式無效")

    params = [("type", "prebuilt"), ("page_size", "50")]
    if search:
        params.append(("search", search))
    if language_code:
        params.append(("language_code", language_code))
    if gender:
        params.append(("gender", gender))
    if page_token:
        params.append(("page_token", page_token))
    return params


def sanitize_gemini_voice_list_response(response):
    if not isinstance(response, dict) or not isinstance(response.get("voices", []), list):
        raise ValueError("Gemini 聲線清單格式無效")

    voices = []
    for voice in response.get("voices", []):
        if not isinstance(voice, dict) or voice.get("type") not in {"prebuilt", "VOICE_TYPE_PREBUILT"}:
            continue
        voice_id = voice.get("id")
        if not isinstance(voice_id, str) or not GEMINI_VOICE_ID.fullmatch(voice_id):
            continue

        def public_text(field, limit=1000):
            value = voice.get(field)
            return value.strip()[:limit] if isinstance(value, str) else ""

        voices.append({
            "id": voice_id,
            "displayName": public_text("display_name", 200) or voice_id,
            "description": public_text("description"),
            "gender": public_text("gender", 30).lower(),
            "languageCode": public_text("language_code", 40),
            "accent": public_text("accent", 200),
            "persona": public_text("persona", 200),
            "pitch": public_text("pitch", 30).lower(),
            "context": public_text("context", 200),
            "regionCode": public_text("region_code", 30),
        })

    next_page_token = response.get("next_page_token", "")
    if not isinstance(next_page_token, str) or len(next_page_token) > 4096 or not next_page_token.isprintable():
        next_page_token = ""
    return {"voices": voices, "nextPageToken": next_page_token}


def build_gemini_tts_preview_request(data):
    if not isinstance(data, dict):
        raise ValueError("聲線試聽設定格式無效")
    language_code = data.get("languageCode", "")
    if not isinstance(language_code, str):
        raise ValueError("聲線語言代碼格式無效")
    language_code = language_code.strip()
    if language_code and not GEMINI_LANGUAGE_CODE.fullmatch(language_code):
        raise ValueError("聲線語言代碼格式無效")

    normalized_language = language_code.lower()
    language = normalized_language.split("-", 1)[0] if normalized_language else "en"
    text = GEMINI_TTS_PREVIEW_TEXTS.get(language, GEMINI_TTS_PREVIEW_TEXTS["en"])
    payload = build_gemini_tts_request({
        "model": data.get("model"),
        "voice": data.get("voice"),
        "text": text,
        "style": "",
    })
    return payload, normalized_language, text


def gemini_tts_preview_cache_name(model, voice, language_code, text):
    key = json.dumps(
        [GEMINI_TTS_PREVIEW_TEXT_VERSION, model, voice, language_code, text],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"{hashlib.sha256(key).hexdigest()}.wav"


def read_gemini_tts_preview_cache(cache_directory, cache_name):
    if not re.fullmatch(r"[0-9a-f]{64}\.wav", cache_name):
        raise ValueError("Invalid preview cache name")
    target = Path(cache_directory) / cache_name
    try:
        wav = target.read_bytes()
    except OSError:
        return None
    if _is_gemini_tts_wav(wav):
        return wav
    target.unlink(missing_ok=True)
    return None


def write_gemini_tts_preview_cache(cache_directory, cache_name, wav):
    if not re.fullmatch(r"[0-9a-f]{64}\.wav", cache_name) or not _is_gemini_tts_wav(wav):
        raise ValueError("Invalid preview cache data")
    directory = Path(cache_directory)
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=directory, suffix=".tmp", delete=False) as temporary:
        temporary_path = Path(temporary.name)
        temporary.write(wav)
    try:
        temporary_path.replace(directory / cache_name)
    finally:
        temporary_path.unlink(missing_ok=True)


def _is_gemini_tts_wav(wav):
    return isinstance(wav, bytes) and len(wav) >= 12 and wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"


def extract_gemini_tts_wav(interaction):
    if not isinstance(interaction, dict) or not isinstance(interaction.get("steps"), list):
        raise ValueError("Gemini 回應中沒有可用的 WAV 音訊")

    audio_data = []
    for step in interaction["steps"]:
        if not isinstance(step, dict) or step.get("type") != "model_output":
            continue
        content_items = step.get("content")
        if not isinstance(content_items, list):
            continue
        for content in content_items:
            if isinstance(content, dict) and content.get("type") == "audio":
                data = content.get("data")
                mime_type = content.get("mime_type")
                if isinstance(data, str) and (not mime_type or mime_type == "audio/wav"):
                    audio_data.append(data)

    if not audio_data:
        raise ValueError("Gemini 回應中沒有可用的 WAV 音訊")

    try:
        wav = base64.b64decode(audio_data[-1], validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("Gemini 回傳的音訊資料無法解碼") from error

    if not _is_gemini_tts_wav(wav):
        raise ValueError("Gemini 回傳的音訊不是有效的 WAV 檔")
    return wav


def save_gemini_tts_audio(output_root, wav, model, voice):
    audio_folder = Path(output_root) / GEMINI_TTS_OUTPUT_SUBFOLDER
    audio_folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = audio_folder / f"H3_Studio_TTS_{stamp}_{uuid.uuid4().hex[:6]}.wav"
    metadata_path = target.with_suffix(".wav.h3.json")
    metadata = {"model": model, "voice": voice}
    try:
        target.write_bytes(wav)
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    except OSError:
        target.unlink(missing_ok=True)
        metadata_path.unlink(missing_ok=True)
        raise
    return {
        "filename": target.name,
        "subfolder": GEMINI_TTS_OUTPUT_SUBFOLDER,
        "type": "output",
        "kind": "audio",
        "modifiedAt": target.stat().st_mtime,
        **metadata,
    }


def list_gemini_tts_audio(output_root):
    audio_folder = Path(output_root) / GEMINI_TTS_OUTPUT_SUBFOLDER
    if not audio_folder.is_dir():
        return []
    outputs = []
    for target in audio_folder.iterdir():
        if not target.is_file() or not is_gemini_tts_filename(target.name):
            continue
        item = {"filename": target.name, "subfolder": GEMINI_TTS_OUTPUT_SUBFOLDER, "type": "output", "kind": "audio", "modifiedAt": target.stat().st_mtime}
        metadata_path = target.with_suffix(".wav.h3.json")
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            if isinstance(metadata, dict):
                item.update({key: metadata[key] for key in ("model", "voice") if isinstance(metadata.get(key), str)})
        except (OSError, json.JSONDecodeError):
            pass
        outputs.append(item)
    return outputs


def gemini_tts_http_error(status):
    if status in {401, 403}:
        return "Gemini API 金鑰無效，或目前沒有權限使用此模型。"
    if status == 429:
        return "Gemini API 額度已用完或請求過多，請稍後再試。"
    if status == 400:
        return "Gemini API 無法接受這次語音設定；文字可能超過單次模型上限，請檢查內容或分段生成。"
    if status >= 500:
        return "Gemini 服務暫時無法使用，請稍後再試。"
    return f"Gemini TTS 請求失敗（HTTP {status}）。"
