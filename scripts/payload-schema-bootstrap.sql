-- Payload (`payload` schema) bootstrap DDL — structure only, no data.
-- WHY: Payload's postgresAdapter push:true does NOT reliably run in the Vercel serverless
-- production runtime, so a fresh database gets the public schema (via prisma db push in the
-- build) but NOT the payload schema. Apply this once to a fresh prod DB to create payload.*
--   psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 -f scripts/payload-schema-bootstrap.sql
-- Idempotent guard: only the schema create is IF NOT EXISTS; run only on a DB without payload.*
-- FOLLOW-UP: generate proper Payload migrations (payload migrate:create) for tracked deploys.

CREATE SCHEMA IF NOT EXISTS payload;
--
-- PostgreSQL database dump
--

\restrict nWgyB3PEDP4R3osYeGNe70m225l4oxumUK8l1O4rcaBljMlLIOe8nb33bp1MAYo

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: payload; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: enum__news_v_version_status; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum__news_v_version_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: enum__rules_v_version_category; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum__rules_v_version_category AS ENUM (
    'general',
    'tournament',
    'format',
    'conduct'
);


--
-- Name: enum__rules_v_version_status; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum__rules_v_version_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: enum_news_status; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum_news_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: enum_rules_category; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum_rules_category AS ENUM (
    'general',
    'tournament',
    'format',
    'conduct'
);


--
-- Name: enum_rules_status; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum_rules_status AS ENUM (
    'draft',
    'published'
);


--
-- Name: enum_users_roles; Type: TYPE; Schema: payload; Owner: -
--

CREATE TYPE payload.enum_users_roles AS ENUM (
    'owner',
    'admin',
    'member'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _news_v; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload._news_v (
    id integer NOT NULL,
    parent_id integer,
    version_title character varying,
    version_slug character varying,
    version_excerpt character varying,
    version_content jsonb,
    version_cover_image_id integer,
    version_featured boolean DEFAULT false,
    version_published_at timestamp(3) with time zone,
    version_related_competition_slug character varying,
    version_related_player_legacy_id character varying,
    version_updated_at timestamp(3) with time zone,
    version_created_at timestamp(3) with time zone,
    version__status payload.enum__news_v_version_status DEFAULT 'draft'::payload.enum__news_v_version_status,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    latest boolean
);


--
-- Name: _news_v_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload._news_v_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _news_v_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload._news_v_id_seq OWNED BY payload._news_v.id;


--
-- Name: _rules_v; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload._rules_v (
    id integer NOT NULL,
    parent_id integer,
    version_title character varying,
    version_slug character varying,
    version_category payload.enum__rules_v_version_category DEFAULT 'general'::payload.enum__rules_v_version_category,
    version_content jsonb,
    version_effective_from timestamp(3) with time zone,
    version_version_label character varying,
    version_updated_at timestamp(3) with time zone,
    version_created_at timestamp(3) with time zone,
    version__status payload.enum__rules_v_version_status DEFAULT 'draft'::payload.enum__rules_v_version_status,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    latest boolean
);


--
-- Name: _rules_v_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload._rules_v_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _rules_v_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload._rules_v_id_seq OWNED BY payload._rules_v.id;


--
-- Name: media; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.media (
    id integer NOT NULL,
    alt character varying NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    url character varying,
    thumbnail_u_r_l character varying,
    filename character varying,
    mime_type character varying,
    filesize numeric,
    width numeric,
    height numeric,
    focal_x numeric,
    focal_y numeric
);


--
-- Name: media_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.media_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: media_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.media_id_seq OWNED BY payload.media.id;


--
-- Name: news; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.news (
    id integer NOT NULL,
    title character varying,
    slug character varying,
    excerpt character varying,
    content jsonb,
    cover_image_id integer,
    featured boolean DEFAULT false,
    published_at timestamp(3) with time zone,
    related_competition_slug character varying,
    related_player_legacy_id character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    _status payload.enum_news_status DEFAULT 'draft'::payload.enum_news_status
);


--
-- Name: news_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.news_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: news_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.news_id_seq OWNED BY payload.news.id;


--
-- Name: payload_kv; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.payload_kv (
    id integer NOT NULL,
    key character varying NOT NULL,
    data jsonb NOT NULL
);


--
-- Name: payload_kv_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.payload_kv_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payload_kv_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.payload_kv_id_seq OWNED BY payload.payload_kv.id;


--
-- Name: payload_locked_documents; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.payload_locked_documents (
    id integer NOT NULL,
    global_slug character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);


--
-- Name: payload_locked_documents_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.payload_locked_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payload_locked_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.payload_locked_documents_id_seq OWNED BY payload.payload_locked_documents.id;


--
-- Name: payload_locked_documents_rels; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.payload_locked_documents_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    users_id integer,
    media_id integer,
    news_id integer,
    rules_id integer
);


--
-- Name: payload_locked_documents_rels_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.payload_locked_documents_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payload_locked_documents_rels_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.payload_locked_documents_rels_id_seq OWNED BY payload.payload_locked_documents_rels.id;


--
-- Name: payload_migrations; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.payload_migrations (
    id integer NOT NULL,
    name character varying,
    batch numeric,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);


--
-- Name: payload_migrations_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.payload_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payload_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.payload_migrations_id_seq OWNED BY payload.payload_migrations.id;


--
-- Name: payload_preferences; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.payload_preferences (
    id integer NOT NULL,
    key character varying,
    value jsonb,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);


--
-- Name: payload_preferences_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.payload_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payload_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.payload_preferences_id_seq OWNED BY payload.payload_preferences.id;


--
-- Name: payload_preferences_rels; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.payload_preferences_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    users_id integer
);


--
-- Name: payload_preferences_rels_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.payload_preferences_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payload_preferences_rels_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.payload_preferences_rels_id_seq OWNED BY payload.payload_preferences_rels.id;


--
-- Name: rules; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.rules (
    id integer NOT NULL,
    title character varying,
    slug character varying,
    category payload.enum_rules_category DEFAULT 'general'::payload.enum_rules_category,
    content jsonb,
    effective_from timestamp(3) with time zone,
    version_label character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    _status payload.enum_rules_status DEFAULT 'draft'::payload.enum_rules_status
);


--
-- Name: rules_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.rules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rules_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.rules_id_seq OWNED BY payload.rules.id;


--
-- Name: users; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.users (
    id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    email character varying NOT NULL,
    username character varying NOT NULL,
    reset_password_token character varying,
    reset_password_expiration timestamp(3) with time zone,
    salt character varying,
    hash character varying,
    login_attempts numeric DEFAULT 0,
    lock_until timestamp(3) with time zone
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.users_id_seq OWNED BY payload.users.id;


--
-- Name: users_roles; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.users_roles (
    "order" integer NOT NULL,
    parent_id integer NOT NULL,
    value payload.enum_users_roles,
    id integer NOT NULL
);


--
-- Name: users_roles_id_seq; Type: SEQUENCE; Schema: payload; Owner: -
--

CREATE SEQUENCE payload.users_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: payload; Owner: -
--

ALTER SEQUENCE payload.users_roles_id_seq OWNED BY payload.users_roles.id;


--
-- Name: users_sessions; Type: TABLE; Schema: payload; Owner: -
--

CREATE TABLE payload.users_sessions (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    created_at timestamp(3) with time zone,
    expires_at timestamp(3) with time zone NOT NULL
);


--
-- Name: _news_v id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._news_v ALTER COLUMN id SET DEFAULT nextval('payload._news_v_id_seq'::regclass);


--
-- Name: _rules_v id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._rules_v ALTER COLUMN id SET DEFAULT nextval('payload._rules_v_id_seq'::regclass);


--
-- Name: media id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.media ALTER COLUMN id SET DEFAULT nextval('payload.media_id_seq'::regclass);


--
-- Name: news id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.news ALTER COLUMN id SET DEFAULT nextval('payload.news_id_seq'::regclass);


--
-- Name: payload_kv id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_kv ALTER COLUMN id SET DEFAULT nextval('payload.payload_kv_id_seq'::regclass);


--
-- Name: payload_locked_documents id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents ALTER COLUMN id SET DEFAULT nextval('payload.payload_locked_documents_id_seq'::regclass);


--
-- Name: payload_locked_documents_rels id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels ALTER COLUMN id SET DEFAULT nextval('payload.payload_locked_documents_rels_id_seq'::regclass);


--
-- Name: payload_migrations id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_migrations ALTER COLUMN id SET DEFAULT nextval('payload.payload_migrations_id_seq'::regclass);


--
-- Name: payload_preferences id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_preferences ALTER COLUMN id SET DEFAULT nextval('payload.payload_preferences_id_seq'::regclass);


--
-- Name: payload_preferences_rels id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_preferences_rels ALTER COLUMN id SET DEFAULT nextval('payload.payload_preferences_rels_id_seq'::regclass);


--
-- Name: rules id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.rules ALTER COLUMN id SET DEFAULT nextval('payload.rules_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users ALTER COLUMN id SET DEFAULT nextval('payload.users_id_seq'::regclass);


--
-- Name: users_roles id; Type: DEFAULT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users_roles ALTER COLUMN id SET DEFAULT nextval('payload.users_roles_id_seq'::regclass);


--
-- Name: _news_v _news_v_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._news_v
    ADD CONSTRAINT _news_v_pkey PRIMARY KEY (id);


--
-- Name: _rules_v _rules_v_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._rules_v
    ADD CONSTRAINT _rules_v_pkey PRIMARY KEY (id);


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.media
    ADD CONSTRAINT media_pkey PRIMARY KEY (id);


--
-- Name: news news_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.news
    ADD CONSTRAINT news_pkey PRIMARY KEY (id);


--
-- Name: payload_kv payload_kv_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_kv
    ADD CONSTRAINT payload_kv_pkey PRIMARY KEY (id);


--
-- Name: payload_locked_documents payload_locked_documents_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents
    ADD CONSTRAINT payload_locked_documents_pkey PRIMARY KEY (id);


--
-- Name: payload_locked_documents_rels payload_locked_documents_rels_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_pkey PRIMARY KEY (id);


--
-- Name: payload_migrations payload_migrations_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_migrations
    ADD CONSTRAINT payload_migrations_pkey PRIMARY KEY (id);


--
-- Name: payload_preferences payload_preferences_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_preferences
    ADD CONSTRAINT payload_preferences_pkey PRIMARY KEY (id);


--
-- Name: payload_preferences_rels payload_preferences_rels_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_pkey PRIMARY KEY (id);


--
-- Name: rules rules_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.rules
    ADD CONSTRAINT rules_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users_roles users_roles_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users_roles
    ADD CONSTRAINT users_roles_pkey PRIMARY KEY (id);


--
-- Name: users_sessions users_sessions_pkey; Type: CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users_sessions
    ADD CONSTRAINT users_sessions_pkey PRIMARY KEY (id);


--
-- Name: _news_v_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_created_at_idx ON payload._news_v USING btree (created_at);


--
-- Name: _news_v_latest_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_latest_idx ON payload._news_v USING btree (latest);


--
-- Name: _news_v_parent_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_parent_idx ON payload._news_v USING btree (parent_id);


--
-- Name: _news_v_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_updated_at_idx ON payload._news_v USING btree (updated_at);


--
-- Name: _news_v_version_version__status_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_version_version__status_idx ON payload._news_v USING btree (version__status);


--
-- Name: _news_v_version_version_cover_image_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_version_version_cover_image_idx ON payload._news_v USING btree (version_cover_image_id);


--
-- Name: _news_v_version_version_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_version_version_created_at_idx ON payload._news_v USING btree (version_created_at);


--
-- Name: _news_v_version_version_slug_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_version_version_slug_idx ON payload._news_v USING btree (version_slug);


--
-- Name: _news_v_version_version_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _news_v_version_version_updated_at_idx ON payload._news_v USING btree (version_updated_at);


--
-- Name: _rules_v_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_created_at_idx ON payload._rules_v USING btree (created_at);


--
-- Name: _rules_v_latest_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_latest_idx ON payload._rules_v USING btree (latest);


--
-- Name: _rules_v_parent_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_parent_idx ON payload._rules_v USING btree (parent_id);


--
-- Name: _rules_v_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_updated_at_idx ON payload._rules_v USING btree (updated_at);


--
-- Name: _rules_v_version_version__status_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_version_version__status_idx ON payload._rules_v USING btree (version__status);


--
-- Name: _rules_v_version_version_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_version_version_created_at_idx ON payload._rules_v USING btree (version_created_at);


--
-- Name: _rules_v_version_version_slug_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_version_version_slug_idx ON payload._rules_v USING btree (version_slug);


--
-- Name: _rules_v_version_version_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX _rules_v_version_version_updated_at_idx ON payload._rules_v USING btree (version_updated_at);


--
-- Name: media_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX media_created_at_idx ON payload.media USING btree (created_at);


--
-- Name: media_filename_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE UNIQUE INDEX media_filename_idx ON payload.media USING btree (filename);


--
-- Name: media_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX media_updated_at_idx ON payload.media USING btree (updated_at);


--
-- Name: news__status_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX news__status_idx ON payload.news USING btree (_status);


--
-- Name: news_cover_image_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX news_cover_image_idx ON payload.news USING btree (cover_image_id);


--
-- Name: news_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX news_created_at_idx ON payload.news USING btree (created_at);


--
-- Name: news_slug_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE UNIQUE INDEX news_slug_idx ON payload.news USING btree (slug);


--
-- Name: news_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX news_updated_at_idx ON payload.news USING btree (updated_at);


--
-- Name: payload_kv_key_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE UNIQUE INDEX payload_kv_key_idx ON payload.payload_kv USING btree (key);


--
-- Name: payload_locked_documents_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_created_at_idx ON payload.payload_locked_documents USING btree (created_at);


--
-- Name: payload_locked_documents_global_slug_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_global_slug_idx ON payload.payload_locked_documents USING btree (global_slug);


--
-- Name: payload_locked_documents_rels_media_id_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_media_id_idx ON payload.payload_locked_documents_rels USING btree (media_id);


--
-- Name: payload_locked_documents_rels_news_id_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_news_id_idx ON payload.payload_locked_documents_rels USING btree (news_id);


--
-- Name: payload_locked_documents_rels_order_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_order_idx ON payload.payload_locked_documents_rels USING btree ("order");


--
-- Name: payload_locked_documents_rels_parent_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_parent_idx ON payload.payload_locked_documents_rels USING btree (parent_id);


--
-- Name: payload_locked_documents_rels_path_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_path_idx ON payload.payload_locked_documents_rels USING btree (path);


--
-- Name: payload_locked_documents_rels_rules_id_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_rules_id_idx ON payload.payload_locked_documents_rels USING btree (rules_id);


--
-- Name: payload_locked_documents_rels_users_id_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_rels_users_id_idx ON payload.payload_locked_documents_rels USING btree (users_id);


--
-- Name: payload_locked_documents_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_locked_documents_updated_at_idx ON payload.payload_locked_documents USING btree (updated_at);


--
-- Name: payload_migrations_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_migrations_created_at_idx ON payload.payload_migrations USING btree (created_at);


--
-- Name: payload_migrations_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_migrations_updated_at_idx ON payload.payload_migrations USING btree (updated_at);


--
-- Name: payload_preferences_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_created_at_idx ON payload.payload_preferences USING btree (created_at);


--
-- Name: payload_preferences_key_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_key_idx ON payload.payload_preferences USING btree (key);


--
-- Name: payload_preferences_rels_order_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_rels_order_idx ON payload.payload_preferences_rels USING btree ("order");


--
-- Name: payload_preferences_rels_parent_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_rels_parent_idx ON payload.payload_preferences_rels USING btree (parent_id);


--
-- Name: payload_preferences_rels_path_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_rels_path_idx ON payload.payload_preferences_rels USING btree (path);


--
-- Name: payload_preferences_rels_users_id_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_rels_users_id_idx ON payload.payload_preferences_rels USING btree (users_id);


--
-- Name: payload_preferences_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX payload_preferences_updated_at_idx ON payload.payload_preferences USING btree (updated_at);


--
-- Name: rules__status_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX rules__status_idx ON payload.rules USING btree (_status);


--
-- Name: rules_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX rules_created_at_idx ON payload.rules USING btree (created_at);


--
-- Name: rules_slug_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE UNIQUE INDEX rules_slug_idx ON payload.rules USING btree (slug);


--
-- Name: rules_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX rules_updated_at_idx ON payload.rules USING btree (updated_at);


--
-- Name: users_created_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX users_created_at_idx ON payload.users USING btree (created_at);


--
-- Name: users_email_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE UNIQUE INDEX users_email_idx ON payload.users USING btree (email);


--
-- Name: users_roles_order_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX users_roles_order_idx ON payload.users_roles USING btree ("order");


--
-- Name: users_roles_parent_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX users_roles_parent_idx ON payload.users_roles USING btree (parent_id);


--
-- Name: users_sessions_order_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX users_sessions_order_idx ON payload.users_sessions USING btree (_order);


--
-- Name: users_sessions_parent_id_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX users_sessions_parent_id_idx ON payload.users_sessions USING btree (_parent_id);


--
-- Name: users_updated_at_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE INDEX users_updated_at_idx ON payload.users USING btree (updated_at);


--
-- Name: users_username_idx; Type: INDEX; Schema: payload; Owner: -
--

CREATE UNIQUE INDEX users_username_idx ON payload.users USING btree (username);


--
-- Name: _news_v _news_v_parent_id_news_id_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._news_v
    ADD CONSTRAINT _news_v_parent_id_news_id_fk FOREIGN KEY (parent_id) REFERENCES payload.news(id) ON DELETE SET NULL;


--
-- Name: _news_v _news_v_version_cover_image_id_media_id_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._news_v
    ADD CONSTRAINT _news_v_version_cover_image_id_media_id_fk FOREIGN KEY (version_cover_image_id) REFERENCES payload.media(id) ON DELETE SET NULL;


--
-- Name: _rules_v _rules_v_parent_id_rules_id_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload._rules_v
    ADD CONSTRAINT _rules_v_parent_id_rules_id_fk FOREIGN KEY (parent_id) REFERENCES payload.rules(id) ON DELETE SET NULL;


--
-- Name: news news_cover_image_id_media_id_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.news
    ADD CONSTRAINT news_cover_image_id_media_id_fk FOREIGN KEY (cover_image_id) REFERENCES payload.media(id) ON DELETE SET NULL;


--
-- Name: payload_locked_documents_rels payload_locked_documents_rels_media_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_media_fk FOREIGN KEY (media_id) REFERENCES payload.media(id) ON DELETE CASCADE;


--
-- Name: payload_locked_documents_rels payload_locked_documents_rels_news_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_news_fk FOREIGN KEY (news_id) REFERENCES payload.news(id) ON DELETE CASCADE;


--
-- Name: payload_locked_documents_rels payload_locked_documents_rels_parent_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES payload.payload_locked_documents(id) ON DELETE CASCADE;


--
-- Name: payload_locked_documents_rels payload_locked_documents_rels_rules_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_rules_fk FOREIGN KEY (rules_id) REFERENCES payload.rules(id) ON DELETE CASCADE;


--
-- Name: payload_locked_documents_rels payload_locked_documents_rels_users_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_users_fk FOREIGN KEY (users_id) REFERENCES payload.users(id) ON DELETE CASCADE;


--
-- Name: payload_preferences_rels payload_preferences_rels_parent_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES payload.payload_preferences(id) ON DELETE CASCADE;


--
-- Name: payload_preferences_rels payload_preferences_rels_users_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_users_fk FOREIGN KEY (users_id) REFERENCES payload.users(id) ON DELETE CASCADE;


--
-- Name: users_roles users_roles_parent_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users_roles
    ADD CONSTRAINT users_roles_parent_fk FOREIGN KEY (parent_id) REFERENCES payload.users(id) ON DELETE CASCADE;


--
-- Name: users_sessions users_sessions_parent_id_fk; Type: FK CONSTRAINT; Schema: payload; Owner: -
--

ALTER TABLE ONLY payload.users_sessions
    ADD CONSTRAINT users_sessions_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES payload.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict nWgyB3PEDP4R3osYeGNe70m225l4oxumUK8l1O4rcaBljMlLIOe8nb33bp1MAYo

