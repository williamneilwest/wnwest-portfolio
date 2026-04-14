import os
from datetime import datetime, timezone
from sqlalchemy import String, Column, DateTime, Integer, ForeignKey, create_engine, inspect, text, Text
from sqlalchemy.orm import declarative_base, sessionmaker

from .platform import resolve_database_url

# Database URL preference: REFERENCE_DATABASE_URL override, then DATABASE_URL/postgres fallback, then SQLite.
_DEFAULT_DB_URL = (
    str(os.getenv('REFERENCE_DATABASE_URL', '')).strip()
    or resolve_database_url()
)

engine = create_engine(_DEFAULT_DB_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)

Base = declarative_base()


class Group(Base):
    __tablename__ = 'ref_groups'

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(Text)
    tags = Column(Text)


class User(Base):
    __tablename__ = 'ref_users'

    id = Column(String, primary_key=True)
    name = Column(String)
    email = Column(String)
    source = Column(String)
    last_synced = Column(DateTime)


class UserGroup(Base):
    __tablename__ = 'ref_user_groups'

    user_id = Column(String, ForeignKey('ref_users.id'), primary_key=True, nullable=False)
    group_id = Column(String, ForeignKey('ref_groups.id'), primary_key=True, nullable=False)
    source = Column(String)
    last_synced = Column(DateTime)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Endpoint(Base):
    __tablename__ = 'ref_endpoints'

    # Use Flask endpoint name as the primary key (unique per app)
    id = Column(String, primary_key=True)  # flask endpoint name, e.g. 'ai.chat'
    name = Column(String, nullable=False)  # display name
    rule = Column(String, nullable=False)  # URL pattern, e.g. '/api/ai/chat'
    methods = Column(String, nullable=False)  # comma-separated methods, e.g. 'GET,POST'
    description = Column(Text)  # taken from view function docstring when available


class AIDocument(Base):
    __tablename__ = 'ai_documents'

    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String, nullable=False)
    original_path = Column(String, nullable=False)
    file_type = Column(String)
    source = Column(String)
    parsed_text = Column(Text)
    ai_summary = Column(Text)
    ai_structured = Column(Text)
    tags = Column(Text)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class AIAnalysis(Base):
    __tablename__ = 'ai_analysis'

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_name = Column(String, nullable=False)
    raw_text = Column(Text, nullable=False)
    full_analysis = Column(Text, nullable=False)
    quick_summary = Column(Text, nullable=False)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


def init_db():
    """Create tables if they do not exist yet."""
    Base.metadata.create_all(engine)
    _ensure_reference_group_columns()
    _ensure_reference_user_columns()
    _ensure_ai_analysis_columns()
    _ensure_user_group_columns()


def _ensure_reference_group_columns():
    inspector = inspect(engine)
    try:
        columns = {column['name'] for column in inspector.get_columns('ref_groups')}
    except Exception:
        return

    statements = []
    if 'description' not in columns:
        statements.append('ALTER TABLE ref_groups ADD COLUMN description TEXT')
    if 'tags' not in columns:
        statements.append('ALTER TABLE ref_groups ADD COLUMN tags TEXT')

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_ai_analysis_columns():
    inspector = inspect(engine)
    try:
        columns = {column['name'] for column in inspector.get_columns('ai_analysis')}
    except Exception:
        return

    statements = []
    if 'input_tokens' not in columns:
        statements.append('ALTER TABLE ai_analysis ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0')
    if 'output_tokens' not in columns:
        statements.append('ALTER TABLE ai_analysis ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0')

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_reference_user_columns():
    inspector = inspect(engine)
    try:
        columns = {column['name'] for column in inspector.get_columns('ref_users')}
    except Exception:
        return

    statements = []
    if 'source' not in columns:
        statements.append('ALTER TABLE ref_users ADD COLUMN source VARCHAR')
    if 'last_synced' not in columns:
        statements.append('ALTER TABLE ref_users ADD COLUMN last_synced DATETIME')

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def _ensure_user_group_columns():
    inspector = inspect(engine)
    try:
        tables = set(inspector.get_table_names())
    except Exception:
        return

    if 'ref_user_groups' not in tables:
        # Table is created through Base.metadata.create_all in init_db.
        return

    try:
        columns = {column['name'] for column in inspector.get_columns('ref_user_groups')}
    except Exception:
        return

    statements = []
    if 'source' not in columns:
        statements.append('ALTER TABLE ref_user_groups ADD COLUMN source VARCHAR')
    if 'last_synced' not in columns:
        statements.append('ALTER TABLE ref_user_groups ADD COLUMN last_synced DATETIME')
    if 'created_at' not in columns:
        statements.append('ALTER TABLE ref_user_groups ADD COLUMN created_at DATETIME')
    if 'updated_at' not in columns:
        statements.append('ALTER TABLE ref_user_groups ADD COLUMN updated_at DATETIME')

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


# Ensure tables exist when the module is imported (safe for SQLite/no-op if exists)
try:
    init_db()
except Exception:
    # Avoid crashing app import path; routes will attempt again on first use if needed
    pass
