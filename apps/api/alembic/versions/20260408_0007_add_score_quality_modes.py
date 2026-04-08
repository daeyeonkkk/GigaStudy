"""add score quality mode columns

Revision ID: 20260408_0007
Revises: 20260407_0006
Create Date: 2026-04-08 18:40:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260408_0007"
down_revision: str | None = "20260407_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "scores",
        sa.Column(
            "pitch_quality_mode",
            sa.String(length=64),
            nullable=False,
            server_default="COARSE_CONTOUR_V1",
        ),
    )
    op.add_column(
        "scores",
        sa.Column(
            "harmony_reference_mode",
            sa.String(length=64),
            nullable=False,
            server_default="KEY_ONLY",
        ),
    )


def downgrade() -> None:
    op.drop_column("scores", "harmony_reference_mode")
    op.drop_column("scores", "pitch_quality_mode")
