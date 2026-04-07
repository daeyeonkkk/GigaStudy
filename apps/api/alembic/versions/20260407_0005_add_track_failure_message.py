"""add track failure message

Revision ID: 20260407_0005
Revises: 20260407_0004
Create Date: 2026-04-07 00:00:05.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260407_0005"
down_revision = "20260407_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tracks", sa.Column("failure_message", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    op.drop_column("tracks", "failure_message")
