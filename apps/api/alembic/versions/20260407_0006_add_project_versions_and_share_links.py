"""add project versions and share links

Revision ID: 20260407_0006
Revises: 20260407_0005
Create Date: 2026-04-07 00:00:06.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260407_0006"
down_revision = "20260407_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_versions",
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column(
            "source_type",
            sa.Enum("MANUAL_SNAPSHOT", "SHARE_LINK", name="project_version_source", native_enum=False),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("note", sa.String(length=400), nullable=True),
        sa.Column("snapshot_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_project_versions_project_id_projects")),
        sa.PrimaryKeyConstraint("version_id", name=op.f("pk_project_versions")),
    )
    op.create_index(op.f("ix_project_versions_project_id"), "project_versions", ["project_id"], unique=False)

    op.create_table(
        "share_links",
        sa.Column("share_link_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column(
            "access_scope",
            sa.Enum("READ_ONLY", name="share_access_scope", native_enum=False),
            nullable=False,
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_share_links_project_id_projects")),
        sa.ForeignKeyConstraint(["version_id"], ["project_versions.version_id"], name=op.f("fk_share_links_version_id_project_versions")),
        sa.PrimaryKeyConstraint("share_link_id", name=op.f("pk_share_links")),
        sa.UniqueConstraint("token", name=op.f("uq_share_links_token")),
    )
    op.create_index(op.f("ix_share_links_project_id"), "share_links", ["project_id"], unique=False)
    op.create_index(op.f("ix_share_links_version_id"), "share_links", ["version_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_share_links_version_id"), table_name="share_links")
    op.drop_index(op.f("ix_share_links_project_id"), table_name="share_links")
    op.drop_table("share_links")
    op.drop_index(op.f("ix_project_versions_project_id"), table_name="project_versions")
    op.drop_table("project_versions")
