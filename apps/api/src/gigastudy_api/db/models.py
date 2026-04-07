import enum
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from gigastudy_api.db.base import Base


class TrackRole(str, enum.Enum):
    GUIDE = "GUIDE"
    VOCAL_TAKE = "VOCAL_TAKE"
    MIXDOWN = "MIXDOWN"


class TrackStatus(str, enum.Enum):
    PENDING_UPLOAD = "PENDING_UPLOAD"
    UPLOADING = "UPLOADING"
    READY = "READY"
    FAILED = "FAILED"


class ArtifactType(str, enum.Enum):
    SOURCE_AUDIO = "SOURCE_AUDIO"
    CANONICAL_AUDIO = "CANONICAL_AUDIO"
    WAVEFORM_PEAKS = "WAVEFORM_PEAKS"
    MIXDOWN_AUDIO = "MIXDOWN_AUDIO"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    user_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    nickname: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)

    projects: Mapped[list["Project"]] = relationship(back_populates="user")
    device_profiles: Mapped[list["DeviceProfile"]] = relationship(back_populates="user")


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    project_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    bpm: Mapped[int | None] = mapped_column(Integer)
    base_key: Mapped[str | None] = mapped_column(String(24))
    time_signature: Mapped[str | None] = mapped_column(String(24))
    mode: Mapped[str | None] = mapped_column(String(40))

    user: Mapped["User"] = relationship(back_populates="projects")
    tracks: Mapped[list["Track"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    artifacts: Mapped[list["Artifact"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class Track(TimestampMixin, Base):
    __tablename__ = "tracks"

    track_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.project_id"), nullable=False, index=True)
    track_role: Mapped[TrackRole] = mapped_column(
        Enum(TrackRole, name="track_role", native_enum=False),
        nullable=False,
    )
    track_status: Mapped[TrackStatus] = mapped_column(
        Enum(TrackStatus, name="track_status", native_enum=False),
        nullable=False,
        default=TrackStatus.PENDING_UPLOAD,
    )
    part_type: Mapped[str | None] = mapped_column(String(32))
    take_no: Mapped[int | None] = mapped_column(Integer)
    actual_sample_rate: Mapped[int | None] = mapped_column(Integer)
    storage_key: Mapped[str | None] = mapped_column(String(512))
    source_format: Mapped[str | None] = mapped_column(String(64))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    checksum: Mapped[str | None] = mapped_column(String(128))
    recording_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    recording_finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    project: Mapped["Project"] = relationship(back_populates="tracks")
    artifacts: Mapped[list["Artifact"]] = relationship(
        back_populates="track",
        cascade="all, delete-orphan",
    )


class Artifact(TimestampMixin, Base):
    __tablename__ = "artifacts"

    artifact_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.project_id"), nullable=False, index=True)
    track_id: Mapped[UUID | None] = mapped_column(ForeignKey("tracks.track_id"), index=True)
    artifact_type: Mapped[ArtifactType] = mapped_column(
        Enum(ArtifactType, name="artifact_type", native_enum=False),
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str | None] = mapped_column(String(1024))
    mime_type: Mapped[str | None] = mapped_column(String(128))
    byte_size: Mapped[int | None] = mapped_column(Integer)
    meta_json: Mapped[dict | None] = mapped_column(JSON)
    project: Mapped["Project"] = relationship(back_populates="artifacts")
    track: Mapped["Track | None"] = relationship(back_populates="artifacts")


class DeviceProfile(TimestampMixin, Base):
    __tablename__ = "device_profiles"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "browser",
            "os",
            "input_device_hash",
            "output_route",
            name="uq_device_profiles_user_device_route",
        ),
    )

    device_profile_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.user_id"), nullable=False, index=True)
    browser: Mapped[str] = mapped_column(String(80), nullable=False)
    os: Mapped[str] = mapped_column(String(80), nullable=False)
    input_device_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    output_route: Mapped[str] = mapped_column(String(128), nullable=False)
    requested_constraints_json: Mapped[dict | None] = mapped_column(JSON)
    applied_settings_json: Mapped[dict | None] = mapped_column(JSON)
    actual_sample_rate: Mapped[int | None] = mapped_column(Integer)
    channel_count: Mapped[int | None] = mapped_column(Integer)
    input_latency_est: Mapped[float | None] = mapped_column(Float)
    base_latency: Mapped[float | None] = mapped_column(Float)
    output_latency: Mapped[float | None] = mapped_column(Float)
    calibration_method: Mapped[str | None] = mapped_column(String(64))
    calibration_confidence: Mapped[float | None] = mapped_column(Float)

    user: Mapped["User"] = relationship(back_populates="device_profiles")
