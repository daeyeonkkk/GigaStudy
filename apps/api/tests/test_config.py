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


def test_settings_accepts_json_list_cors_origins(monkeypatch) -> None:
    monkeypatch.setenv(
        "GIGASTUDY_API_CORS_ORIGINS",
        '["http://127.0.0.1:5173","http://localhost:5173"]',
    )

    settings = Settings()

    assert settings.cors_origins == [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]
