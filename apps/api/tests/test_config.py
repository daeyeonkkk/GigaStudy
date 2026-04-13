from gigastudy_api.config import Settings


def test_settings_accepts_comma_separated_cors_origins(monkeypatch) -> None:
    monkeypatch.setenv(
        "GIGASTUDY_API_CORS_ORIGINS",
        "https://gigastudy-alpha.pages.dev,https://preview.gigastudy-alpha.pages.dev",
    )

    settings = Settings()

    assert settings.cors_origins == [
        "https://gigastudy-alpha.pages.dev",
        "https://preview.gigastudy-alpha.pages.dev",
    ]
