from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from gigastudy_api.config import get_settings


def make_engine(database_url: str, echo: bool = False) -> Engine:
    engine_kwargs: dict[str, object] = {
        "echo": echo,
        "future": True,
        "pool_pre_ping": True,
    }
    if database_url.startswith("sqlite"):
        engine_kwargs["connect_args"] = {"check_same_thread": False}

    return create_engine(database_url, **engine_kwargs)


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    return make_engine(settings.database_url, echo=settings.database_echo)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


def get_db_session() -> Generator[Session, None, None]:
    session = get_session_factory()()

    try:
        yield session
    finally:
        session.close()
