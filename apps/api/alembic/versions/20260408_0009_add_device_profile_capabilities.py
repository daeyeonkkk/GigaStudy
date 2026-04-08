"""add device profile capabilities

Revision ID: 20260408_0009
Revises: 20260408_0008
Create Date: 2026-04-08 21:45:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260408_0009"
down_revision: str | None = "20260408_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("device_profiles", sa.Column("browser_user_agent", sa.String(length=1024), nullable=True))
    op.add_column("device_profiles", sa.Column("capabilities_json", sa.JSON(), nullable=True))
    op.add_column("device_profiles", sa.Column("diagnostic_flags_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("device_profiles", "diagnostic_flags_json")
    op.drop_column("device_profiles", "capabilities_json")
    op.drop_column("device_profiles", "browser_user_agent")
