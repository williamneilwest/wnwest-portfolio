import os
from sqlalchemy import String, Column, create_engine, Text
from sqlalchemy.orm import declarative_base, sessionmaker


# Database URL can be overridden via env; default to a local SQLite file
_DEFAULT_DB_URL = os.getenv('REFERENCE_DATABASE_URL', 'sqlite:///reference.db')

engine = create_engine(_DEFAULT_DB_URL, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)

Base = declarative_base()


class Group(Base):
    __tablename__ = 'ref_groups'

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)


class User(Base):
    __tablename__ = 'ref_users'

    id = Column(String, primary_key=True)
    name = Column(String)
    email = Column(String)


class Endpoint(Base):
    __tablename__ = 'ref_endpoints'

    # Use Flask endpoint name as the primary key (unique per app)
    id = Column(String, primary_key=True)  # flask endpoint name, e.g. 'ai.chat'
    name = Column(String, nullable=False)  # display name
    rule = Column(String, nullable=False)  # URL pattern, e.g. '/api/ai/chat'
    methods = Column(String, nullable=False)  # comma-separated methods, e.g. 'GET,POST'
    description = Column(Text)  # taken from view function docstring when available


def init_db():
    """Create tables if they do not exist yet."""
    Base.metadata.create_all(engine)


# Ensure tables exist when the module is imported (safe for SQLite/no-op if exists)
try:
    init_db()
except Exception:
    # Avoid crashing app import path; routes will attempt again on first use if needed
    pass
