from fastapi import HTTPException

from gigastudy_api.services.upload_policy import (
    guess_audio_mime_type,
    validate_track_upload_filename,
)


def test_webm_audio_upload_is_supported() -> None:
    filename, suffix = validate_track_upload_filename("audio", "bass-take.webm")

    assert filename == "bass-take.webm"
    assert suffix == ".webm"
    assert guess_audio_mime_type(filename) == "audio/webm"


def test_mp4_and_aac_audio_uploads_are_supported_for_browser_fallbacks() -> None:
    assert validate_track_upload_filename("audio", "take.mp4")[1] == ".mp4"
    assert validate_track_upload_filename("audio", "take.aac")[1] == ".aac"
    assert guess_audio_mime_type("take.mp4") == "audio/mp4"
    assert guess_audio_mime_type("take.aac") == "audio/aac"


def test_unsupported_audio_upload_is_still_rejected() -> None:
    try:
        validate_track_upload_filename("audio", "take.exe")
    except HTTPException as error:
        assert error.status_code == 422
    else:
        raise AssertionError("Expected unsupported audio upload to be rejected.")
