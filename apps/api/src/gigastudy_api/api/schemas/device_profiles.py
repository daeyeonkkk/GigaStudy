from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DeviceProfileUpsertRequest(BaseModel):
    browser: str = Field(min_length=1, max_length=80)
    os: str = Field(min_length=1, max_length=80)
    input_device_hash: str = Field(min_length=1, max_length=128)
    output_route: str = Field(min_length=1, max_length=128)
    requested_constraints: dict | None = None
    applied_settings: dict | None = None
    actual_sample_rate: int | None = Field(default=None, ge=1)
    channel_count: int | None = Field(default=None, ge=1)
    input_latency_est: float | None = None
    base_latency: float | None = None
    output_latency: float | None = None
    calibration_method: str | None = Field(default=None, max_length=64)
    calibration_confidence: float | None = None


class DeviceProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    device_profile_id: UUID
    user_id: UUID
    browser: str
    os: str
    input_device_hash: str
    output_route: str
    requested_constraints_json: dict | None
    applied_settings_json: dict | None
    actual_sample_rate: int | None
    channel_count: int | None
    input_latency_est: float | None
    base_latency: float | None
    output_latency: float | None
    calibration_method: str | None
    calibration_confidence: float | None
    created_at: datetime
    updated_at: datetime


class DeviceProfileListResponse(BaseModel):
    items: list[DeviceProfileResponse]
