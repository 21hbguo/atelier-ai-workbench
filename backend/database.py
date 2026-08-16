import re
from datetime import datetime
from backend.db.engine import init_pool
from backend.db.session import get_db

__all__ = ["get_db", "init_db", "create_admin_if_not_exists"]


def _column_exists(conn, table, column):
    row = conn.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, column),
    ).fetchone()
    return row is not None


def _exec(conn, sql):
    conn.execute(sql)


def init_db():
    with get_db() as conn:
        conn.execute("SELECT pg_advisory_lock(%s,%s)", (58231, 19001))
        try:
            statements = [
            """CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(64) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                nickname VARCHAR(128),
                avatar VARCHAR(512),
                invite_code VARCHAR(32),
                invite_code_created_at TIMESTAMP,
                inviter_user_id INTEGER REFERENCES users(id),
                register_invite_code VARCHAR(32) DEFAULT '',
                invited_at TIMESTAMP,
                is_admin BOOLEAN DEFAULT FALSE,
                is_frozen BOOLEAN DEFAULT FALSE,
                last_ip VARCHAR(45),
                last_active TIMESTAMP,
                points NUMERIC(18,4) DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS user_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                status VARCHAR(32) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_user_requests_user_id ON user_requests(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_user_requests_created_at ON user_requests(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS tasks (
                task_id VARCHAR(64) PRIMARY KEY,
                type VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                params JSONB,
                created_at TIMESTAMP,
                updated_at TIMESTAMP,
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                progress INTEGER DEFAULT 0,
                result_urls JSONB,
                error TEXT,
                external_result JSONB,
                user_id INTEGER REFERENCES users(id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)",
            """CREATE TABLE IF NOT EXISTS prompts (
                id VARCHAR(64) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                prompt TEXT NOT NULL,
                negative_prompt TEXT DEFAULT '',
                tags JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP,
                user_id INTEGER REFERENCES users(id),
                likes_count INTEGER DEFAULT 0,
                image_path VARCHAR(512),
                author VARCHAR(128),
                source VARCHAR(512),
                category VARCHAR(64)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name)",
            "CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category)",
            """CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                slug VARCHAR(64) NOT NULL UNIQUE,
                label VARCHAR(128) NOT NULL,
                sort_order INTEGER DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS prompt_likes (
                id SERIAL PRIMARY KEY,
                prompt_id VARCHAR(64) NOT NULL REFERENCES prompts(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(prompt_id, user_id)
            )""",
            """CREATE TABLE IF NOT EXISTS square_images (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                filename VARCHAR(255) NOT NULL,
                prompt TEXT,
                metadata JSONB,
                likes_count INTEGER DEFAULT 0,
                is_frozen BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_square_images_user_id ON square_images(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_square_images_created_at ON square_images(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS square_likes (
                id SERIAL PRIMARY KEY,
                image_id INTEGER NOT NULL REFERENCES square_images(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(image_id, user_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_square_likes_image_id ON square_likes(image_id)",
            "CREATE INDEX IF NOT EXISTS idx_square_likes_user_id ON square_likes(user_id)",
            """CREATE TABLE IF NOT EXISTS favorites (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                target_type VARCHAR(16) NOT NULL,
                target_id VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id,target_type,target_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id,created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_favorites_target ON favorites(target_type,target_id)",
            """CREATE TABLE IF NOT EXISTS stats (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                today_requests INTEGER DEFAULT 0,
                today_success INTEGER DEFAULT 0,
                today_failed INTEGER DEFAULT 0,
                total_requests INTEGER DEFAULT 0,
                total_success INTEGER DEFAULT 0,
                total_failed INTEGER DEFAULT 0,
                last_date VARCHAR(10)
            )""",
            """CREATE TABLE IF NOT EXISTS daily_stats (
                date VARCHAR(10) PRIMARY KEY,
                requests INTEGER DEFAULT 0,
                success INTEGER DEFAULT 0,
                failed INTEGER DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS banned_words (
                id SERIAL PRIMARY KEY,
                word VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS image_mappings (
                id SERIAL PRIMARY KEY,
                local_path VARCHAR(512) NOT NULL UNIQUE,
                url VARCHAR(1024) NOT NULL,
                upload_time TIMESTAMP,
                content_hash VARCHAR(64) DEFAULT '',
                delete_token VARCHAR(128) DEFAULT ''
            )""",
            "CREATE INDEX IF NOT EXISTS idx_image_mappings_hash ON image_mappings(content_hash)",
            """CREATE TABLE IF NOT EXISTS image_metadata (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                metadata JSONB,
                created_at TIMESTAMP,
                user_id INTEGER REFERENCES users(id),
                expires_at TIMESTAMP,
                is_permanent BOOLEAN DEFAULT FALSE
            )""",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_filename ON image_metadata(filename)",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_created_at ON image_metadata(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_user_id ON image_metadata(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_image_metadata_user_created ON image_metadata(user_id, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS recharge_requests (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                channel VARCHAR(32) NOT NULL,
                amount REAL NOT NULL,
                points INTEGER NOT NULL,
                submit_ip VARCHAR(45) DEFAULT '',
                invite_code VARCHAR(32) DEFAULT '',
                inviter_user_id INTEGER REFERENCES users(id),
                invite_discount_percent_snapshot NUMERIC(10,4) DEFAULT 0,
                invite_rebate_percent_snapshot NUMERIC(10,4) DEFAULT 0,
                invite_bonus_points INTEGER DEFAULT 0,
                invite_rebate_points INTEGER DEFAULT 0,
                payer_name VARCHAR(128) DEFAULT '',
                tx_no VARCHAR(128) DEFAULT '',
                proof_url VARCHAR(1024) DEFAULT '',
                remark TEXT DEFAULT '',
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                redeem_code VARCHAR(64) DEFAULT '',
                review_note TEXT DEFAULT '',
                risk_level VARCHAR(16) DEFAULT 'low',
                risk_flags JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP DEFAULT NOW(),
                reviewed_at TIMESTAMP,
                reviewed_by INTEGER REFERENCES users(id),
                user_confirmed BOOLEAN DEFAULT FALSE,
                confirmed_at TIMESTAMP,
                discount NUMERIC(4,2) DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS upload_files (
                id SERIAL PRIMARY KEY,
                file_key VARCHAR(128) NOT NULL UNIQUE,
                owner_id INTEGER NOT NULL REFERENCES users(id),
                original_name VARCHAR(255) NOT NULL,
                storage_name VARCHAR(255) NOT NULL UNIQUE,
                content_type VARCHAR(128) NOT NULL,
                category VARCHAR(32) NOT NULL DEFAULT 'private',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_upload_files_owner_id ON upload_files(owner_id)",
            "CREATE INDEX IF NOT EXISTS idx_upload_files_created_at ON upload_files(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS redemption_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(64) UNIQUE NOT NULL,
                points INTEGER NOT NULL,
                is_used BOOLEAN DEFAULT FALSE,
                used_by INTEGER REFERENCES users(id),
                used_by_ip VARCHAR(45),
                used_at TIMESTAMP,
                recharge_request_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_redemption_codes_code ON redemption_codes(code)",
            "CREATE INDEX IF NOT EXISTS idx_redemption_codes_is_used ON redemption_codes(is_used)",
            """CREATE TABLE IF NOT EXISTS point_transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                amount NUMERIC(18,4) NOT NULL,
                balance_after NUMERIC(18,4) NOT NULL,
                type VARCHAR(32) NOT NULL,
                description TEXT,
                request_key VARCHAR(128),
                model_id VARCHAR(128),
                recharge_request_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_point_tx_user_id ON point_transactions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_point_tx_created_at ON point_transactions(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS provider_purchase_batches (
                id SERIAL PRIMARY KEY,
                provider_id VARCHAR(64) NOT NULL,
                purchase_date TIMESTAMP NOT NULL,
                amount_rmb NUMERIC(18,6) NOT NULL,
                quota_amount NUMERIC(18,6) NOT NULL,
                remaining_quota NUMERIC(18,6) NOT NULL,
                unit_cost NUMERIC(18,8) NOT NULL,
                remark TEXT DEFAULT '',
                operator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_provider_purchase_batches_provider_date ON provider_purchase_batches(provider_id,purchase_date DESC,id DESC)",
            "CREATE INDEX IF NOT EXISTS idx_provider_purchase_batches_remaining ON provider_purchase_batches(provider_id,remaining_quota)",
            """CREATE TABLE IF NOT EXISTS generation_finance_entries (
                id SERIAL PRIMARY KEY,
                task_id VARCHAR(64) NOT NULL UNIQUE REFERENCES tasks(task_id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                model_id VARCHAR(64) NOT NULL,
                provider_id VARCHAR(64) NOT NULL,
                status VARCHAR(32) NOT NULL,
                charged_points INTEGER DEFAULT 0,
                revenue_rmb NUMERIC(18,6) DEFAULT 0,
                cost_rmb NUMERIC(18,6),
                pricing_source VARCHAR(64) DEFAULT '',
                cost_source VARCHAR(64) DEFAULT '',
                purchase_batch_id INTEGER REFERENCES provider_purchase_batches(id) ON DELETE SET NULL,
                quota_used NUMERIC(18,6) DEFAULT 0,
                quota_shortage NUMERIC(18,6) DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_entries_created ON generation_finance_entries(created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_entries_provider_created ON generation_finance_entries(provider_id,created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_entries_model_provider ON generation_finance_entries(model_id,provider_id)",
            """CREATE TABLE IF NOT EXISTS provider_model_quota_rules (
                id SERIAL PRIMARY KEY,
                provider_id VARCHAR(64) NOT NULL,
                model_id VARCHAR(64) NOT NULL,
                quota_per_success NUMERIC(18,6) NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                remark TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(provider_id, model_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_provider_model_quota_rules_provider_model ON provider_model_quota_rules(provider_id,model_id)",
            """CREATE TABLE IF NOT EXISTS generation_finance_allocations (
                id SERIAL PRIMARY KEY,
                finance_entry_id INTEGER NOT NULL REFERENCES generation_finance_entries(id) ON DELETE CASCADE,
                purchase_batch_id INTEGER NOT NULL REFERENCES provider_purchase_batches(id) ON DELETE CASCADE,
                quota_used NUMERIC(18,6) NOT NULL,
                cost_rmb NUMERIC(18,6) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_allocations_entry ON generation_finance_allocations(finance_entry_id)",
            "CREATE INDEX IF NOT EXISTS idx_generation_finance_allocations_batch ON generation_finance_allocations(purchase_batch_id)",
            """CREATE TABLE IF NOT EXISTS daily_checkins (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                checkin_date VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(user_id, checkin_date)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date ON daily_checkins(user_id, checkin_date)",
            "CREATE INDEX IF NOT EXISTS idx_recharge_user_id ON recharge_requests(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_recharge_status ON recharge_requests(status)",
            "CREATE INDEX IF NOT EXISTS idx_recharge_created_at ON recharge_requests(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS invite_events (
                id SERIAL PRIMARY KEY,
                inviter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                invitee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                event_type VARCHAR(32) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'recorded',
                invite_code VARCHAR(32) DEFAULT '',
                request_id INTEGER REFERENCES recharge_requests(id) ON DELETE SET NULL,
                reward_points INTEGER DEFAULT 0,
                recharge_amount REAL DEFAULT 0,
                same_ip_hit BOOLEAN DEFAULT FALSE,
                same_ip_reason VARCHAR(255) DEFAULT '',
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_invite_events_inviter_created ON invite_events(inviter_user_id,created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_invite_events_invitee_created ON invite_events(invitee_user_id,created_at DESC)",
            """CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS announcement_reads (
                id SERIAL PRIMARY KEY,
                announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                read_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(announcement_id, user_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_announcement_reads_ann ON announcement_reads(announcement_id)",
            """CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(32) NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                related_task_id VARCHAR(64),
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                read_at TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)",
            """CREATE TABLE IF NOT EXISTS share_links (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                token VARCHAR(128) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                is_revoked BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_share_links_user_created ON share_links(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token)",
            """CREATE TABLE IF NOT EXISTS import_sources (
                id SERIAL PRIMARY KEY,
                source_key VARCHAR(255) UNIQUE NOT NULL,
                last_imported_at TIMESTAMP,
                record_count INTEGER DEFAULT 0,
                metadata JSONB
            )""",
            """CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(128) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                revoked_at TIMESTAMP,
                last_ip VARCHAR(45) DEFAULT '',
                user_agent VARCHAR(255) DEFAULT ''
            )""",
            "CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at ON auth_refresh_tokens(expires_at)",
            """CREATE TABLE IF NOT EXISTS email_verification_codes (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                code VARCHAR(10) NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                registered BOOLEAN DEFAULT FALSE,
                ip VARCHAR(45) DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_ev_codes_email ON email_verification_codes(email)",
            "CREATE INDEX IF NOT EXISTS idx_ev_codes_created_at ON email_verification_codes(created_at DESC)",
            """CREATE TABLE IF NOT EXISTS classification_tasks (
                id SERIAL PRIMARY KEY,
                status VARCHAR(32) NOT NULL DEFAULT 'processing',
                item_type VARCHAR(32) NOT NULL DEFAULT 'prompt',
                total_items INTEGER NOT NULL DEFAULT 0,
                processed_items INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS idx_cls_tasks_status ON classification_tasks(status)",
            """CREATE TABLE IF NOT EXISTS classification_results (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES classification_tasks(id) ON DELETE CASCADE,
                item_id VARCHAR(64) NOT NULL,
                item_type VARCHAR(32) NOT NULL DEFAULT 'prompt',
                item_name TEXT,
                item_prompt TEXT,
                item_category VARCHAR(64),
                suggested_category VARCHAR(64),
                suggested_category_label VARCHAR(128),
                is_new_category BOOLEAN DEFAULT FALSE,
                confidence VARCHAR(16),
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                reviewed_at TIMESTAMP,
                applied_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_cls_results_task ON classification_results(task_id)",
            "CREATE INDEX IF NOT EXISTS idx_cls_results_status ON classification_results(status)",
            "ALTER TABLE classification_results ADD COLUMN IF NOT EXISTS confidence VARCHAR(16)",
            """CREATE TABLE IF NOT EXISTS content_audit_tasks (
                id SERIAL PRIMARY KEY,
                status VARCHAR(32) NOT NULL DEFAULT 'processing',
                item_type VARCHAR(32) NOT NULL DEFAULT 'prompt',
                source_scope VARCHAR(32) NOT NULL DEFAULT 'square',
                total_items INTEGER NOT NULL DEFAULT 0,
                processed_items INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS idx_audit_tasks_status ON content_audit_tasks(status)",
            """CREATE TABLE IF NOT EXISTS content_audit_results (
                id SERIAL PRIMARY KEY,
                task_id INTEGER NOT NULL REFERENCES content_audit_tasks(id) ON DELETE CASCADE,
                item_id VARCHAR(64) NOT NULL,
                item_type VARCHAR(32) NOT NULL DEFAULT 'prompt',
                source_scope VARCHAR(32) NOT NULL DEFAULT 'square',
                item_name TEXT,
                item_prompt TEXT,
                item_category VARCHAR(64),
                item_author TEXT,
                item_thumb_url TEXT,
                risk_level VARCHAR(16),
                confidence VARCHAR(16),
                suggested_action VARCHAR(32),
                reason_summary TEXT,
                reason_detail TEXT,
                hit_rules JSONB DEFAULT '[]'::jsonb,
                status VARCHAR(32) NOT NULL DEFAULT 'pending',
                reviewed_at TIMESTAMP,
                applied_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_audit_results_task ON content_audit_results(task_id)",
            "CREATE INDEX IF NOT EXISTS idx_audit_results_status ON content_audit_results(status)",
            "ALTER TABLE content_audit_results ADD COLUMN IF NOT EXISTS item_thumb_url TEXT",
            """CREATE TABLE IF NOT EXISTS chat_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                title VARCHAR(255) DEFAULT '新对话',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC)",
            # 迁移：会话上下文压缩状态（前缀缓存友好：历史纯追加，超预算时只把最老轮次摘要压缩）。
            # summary_until = 已被摘要覆盖的最后一条 chat_messages.id（0 表示从未压缩）；
            # summary_text = 当前合并后的摘要文本（不含包裹标签）。
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary_until INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary_text TEXT",
            """CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                role VARCHAR(16) NOT NULL,
                content TEXT NOT NULL,
                citations JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id)",
            # 迁移：聊天消息增加 thinking（思考过程）列，用于前端折叠展示
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thinking TEXT",
            # 迁移：聊天消息增加 file_ids（JSONB 数组，用户消息快照会话关联文件 id，前端显示文件图标）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_ids JSONB",
            # 迁移：聊天消息增加 citations（JSONB 数组，来源引用落库，刷新后仍可展示）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS citations JSONB",
            # 迁移：聊天消息增加 widgets（JSONB 数组，画图工具产出的 SVG/HTML 片段落库，刷新后仍可展示）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS widgets JSONB",
            # 迁移：聊天消息增加 files（JSONB 数组，send_file 工具产出的可下载文件落库，刷新后仍可展示）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS files JSONB",
            # 迁移：聊天消息增加 status（streaming/done/failed/stopped，任务制后台生成的状态机）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'done'",
            # 迁移：聊天消息增加 error（失败/停止时的错误文案，终态展示用）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS error TEXT",
            # 迁移：聊天消息增加 req_id（本次生成请求的唯一 id，服务重启后按它幂等退款）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS req_id VARCHAR(64)",
            # 迁移：聊天消息增加 charge_mode（预扣模式 free/paid/unlimited，重启退款时按它精确退还）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS charge_mode VARCHAR(16)",
            # 迁移：聊天消息增加 daily_total（免费用户每日次数总额，free 模式退款封顶按它计算；
            # 落库避免重启恢复时用「当前套餐」重算导致换档后多退/少退）
            "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS daily_total INT",
            # 迁移：用户自定义指令（用户级长期指令，注入每次 AI 对话的 system prompt；
            # TEXT 无 DB 层长度限制，应用层限 2000 字符；NULL/空串 = 未设置）
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_instructions TEXT",
            """CREATE TABLE IF NOT EXISTS llm_models (
                id SERIAL PRIMARY KEY,
                model_id VARCHAR(128) NOT NULL UNIQUE,
                label VARCHAR(128) NOT NULL,
                protocol VARCHAR(16) NOT NULL DEFAULT 'openai',
                max_input_tokens INTEGER NOT NULL DEFAULT 1000000,
                max_output_tokens INTEGER NOT NULL DEFAULT 128000,
                reasoning_efforts JSONB DEFAULT '["auto","low","medium","high","max","xhigh"]'::jsonb,
                default_reasoning_effort VARCHAR(16) NOT NULL DEFAULT 'auto',
                thinking_default VARCHAR(16) NOT NULL DEFAULT 'enabled',
                context_budget_chars INTEGER NOT NULL DEFAULT 256000,
                input_price_per_million NUMERIC(12,4) DEFAULT NULL,
                output_price_per_million NUMERIC(12,4) DEFAULT NULL,
                price_currency VARCHAR(8) NOT NULL DEFAULT 'usd',
                enabled BOOLEAN DEFAULT TRUE,
                notes TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS chat_files (
                id SERIAL PRIMARY KEY,
                session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                storage_name VARCHAR(255) NOT NULL UNIQUE,
                original_name VARCHAR(255) NOT NULL,
                content_type VARCHAR(128),
                page_content TEXT NOT NULL,
                char_count INTEGER DEFAULT 0,
                status VARCHAR(16) DEFAULT 'parsed',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chat_files_session ON chat_files(session_id)",
            """CREATE TABLE IF NOT EXISTS chat_file_chunks (
                id SERIAL PRIMARY KEY,
                file_id INTEGER NOT NULL REFERENCES chat_files(id) ON DELETE CASCADE,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chunks_file ON chat_file_chunks(file_id)",
            """CREATE TABLE IF NOT EXISTS chat_usage_records (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
                model_key VARCHAR(128),
                request_id VARCHAR(64),
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                cache_creation_tokens INTEGER DEFAULT 0,
                reasoning_tokens INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                cost_points NUMERIC(12,4) DEFAULT 0,
                billing_mode VARCHAR(16) DEFAULT 'token',
                is_refunded BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_chat_usage_user_created ON chat_usage_records(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_chat_usage_session ON chat_usage_records(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_chat_usage_request ON chat_usage_records(request_id)",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS pricing_version_id INTEGER",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS calculated_cost_points NUMERIC(18,4) DEFAULT 0",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS charged_points NUMERIC(18,4) DEFAULT 0",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS subscription_points_used NUMERIC(18,4) DEFAULT 0",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS wallet_points_used NUMERIC(18,4) DEFAULT 0",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS price_snapshot JSONB DEFAULT '{}'::jsonb",
            "ALTER TABLE chat_usage_records ADD COLUMN IF NOT EXISTS usage_missing BOOLEAN DEFAULT FALSE",
            "ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS cache_creation_price_per_million NUMERIC(12,4)",
            """CREATE TABLE IF NOT EXISTS model_price_versions (
                id SERIAL PRIMARY KEY,
                model_id VARCHAR(128) NOT NULL,
                source_currency VARCHAR(8) NOT NULL DEFAULT 'usd',
                input_price_per_million NUMERIC(18,4),
                output_price_per_million NUMERIC(18,4),
                cache_read_price_per_million NUMERIC(18,4),
                cache_creation_price_per_million NUMERIC(18,4),
                usd_cny_fx_rate NUMERIC(18,8) NOT NULL,
                platform_markup NUMERIC(18,8) NOT NULL,
                points_per_rmb NUMERIC(18,4) NOT NULL,
                rmb_input_price_per_million NUMERIC(18,4),
                rmb_output_price_per_million NUMERIC(18,4),
                rmb_cache_read_price_per_million NUMERIC(18,4),
                rmb_cache_creation_price_per_million NUMERIC(18,4),
                points_per_1k_input NUMERIC(18,4),
                points_per_1k_output NUMERIC(18,4),
                points_per_1k_cache_read NUMERIC(18,4),
                points_per_1k_cache_creation NUMERIC(18,4),
                snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                effective_at TIMESTAMP DEFAULT NOW(),
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_model_price_versions_model_effective ON model_price_versions(model_id, effective_at DESC, id DESC)",
            """CREATE TABLE IF NOT EXISTS subscription_plans (
                id SERIAL PRIMARY KEY,
                code VARCHAR(64) UNIQUE NOT NULL,
                name VARCHAR(128) NOT NULL,
                description TEXT DEFAULT '',
                price_rmb NUMERIC(12,2) NOT NULL DEFAULT 0,
                cycle_days INTEGER NOT NULL DEFAULT 30,
                grant_points NUMERIC(18,4) NOT NULL DEFAULT 0,
                features JSONB NOT NULL DEFAULT '{}'::jsonb,
                allowed_models JSONB NOT NULL DEFAULT '[]'::jsonb,
                max_concurrent_requests INTEGER NOT NULL DEFAULT 1,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                is_free BOOLEAN NOT NULL DEFAULT FALSE,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS subscription_orders (
                id SERIAL PRIMARY KEY,
                order_no VARCHAR(64) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL REFERENCES users(id),
                plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
                plan_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                amount_rmb NUMERIC(12,2) NOT NULL,
                channel VARCHAR(32) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                payer_name VARCHAR(128) DEFAULT '',
                tx_no VARCHAR(128) DEFAULT '',
                proof_url VARCHAR(1024) DEFAULT '',
                remark TEXT DEFAULT '',
                submit_ip VARCHAR(45) DEFAULT '',
                risk_level VARCHAR(16) DEFAULT 'low',
                risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
                reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                review_note TEXT DEFAULT '',
                created_at TIMESTAMP DEFAULT NOW(),
                reviewed_at TIMESTAMP
            )""",
            "CREATE INDEX IF NOT EXISTS idx_subscription_orders_user_created ON subscription_orders(user_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_subscription_orders_status_created ON subscription_orders(status, created_at DESC)",
            """CREATE TABLE IF NOT EXISTS user_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                current_cycle_id INTEGER,
                next_plan_id INTEGER REFERENCES subscription_plans(id),
                started_at TIMESTAMP,
                expires_at TIMESTAMP,
                last_order_id INTEGER REFERENCES subscription_orders(id) ON DELETE SET NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS subscription_cycles (
                id SERIAL PRIMARY KEY,
                subscription_id INTEGER NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
                plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
                period_start TIMESTAMP NOT NULL,
                period_end TIMESTAMP NOT NULL,
                granted_points NUMERIC(18,4) NOT NULL DEFAULT 0,
                remaining_points NUMERIC(18,4) NOT NULL DEFAULT 0,
                entitlements_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_subscription_cycles_subscription_period ON subscription_cycles(subscription_id, period_start DESC)",
            """CREATE TABLE IF NOT EXISTS point_buckets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                bucket_type VARCHAR(16) NOT NULL,
                cycle_id INTEGER REFERENCES subscription_cycles(id) ON DELETE SET NULL,
                granted_points NUMERIC(18,4) NOT NULL DEFAULT 0,
                remaining_points NUMERIC(18,4) NOT NULL DEFAULT 0,
                expires_at TIMESTAMP,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_point_buckets_user_consume ON point_buckets(user_id, bucket_type, status, expires_at, id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_point_buckets_permanent_user ON point_buckets(user_id) WHERE bucket_type = 'permanent'",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_point_buckets_cycle ON point_buckets(cycle_id) WHERE cycle_id IS NOT NULL",
            """CREATE TABLE IF NOT EXISTS point_transaction_allocations (
                id SERIAL PRIMARY KEY,
                transaction_id INTEGER NOT NULL REFERENCES point_transactions(id) ON DELETE CASCADE,
                bucket_id INTEGER NOT NULL REFERENCES point_buckets(id) ON DELETE RESTRICT,
                amount NUMERIC(18,4) NOT NULL
            )""",
            "CREATE INDEX IF NOT EXISTS idx_point_allocations_transaction ON point_transaction_allocations(transaction_id)",
            "CREATE INDEX IF NOT EXISTS idx_point_allocations_bucket ON point_transaction_allocations(bucket_id)",
            """CREATE TABLE IF NOT EXISTS billing_audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action VARCHAR(64) NOT NULL,
                target_type VARCHAR(32) NOT NULL,
                target_id VARCHAR(128) NOT NULL,
                reason TEXT DEFAULT '',
                old_state JSONB DEFAULT '{}'::jsonb,
                new_state JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS points_unit_migrations (
                id SERIAL PRIMARY KEY,
                version INTEGER UNIQUE NOT NULL,
                factor NUMERIC(12,4) NOT NULL,
                dry_run BOOLEAN NOT NULL DEFAULT FALSE,
                report JSONB NOT NULL DEFAULT '{}'::jsonb,
                applied_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS group_buys (
                id SERIAL PRIMARY KEY,
                package_id INTEGER NOT NULL REFERENCES subscription_plans(id),
                group_size INTEGER NOT NULL DEFAULT 5,
                group_price NUMERIC(10,2) NOT NULL,
                time_limit_min INTEGER NOT NULL DEFAULT 1440,
                virtual_members INTEGER NOT NULL DEFAULT 2,
                status INTEGER NOT NULL DEFAULT 1,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS group_buy_teams (
                id SERIAL PRIMARY KEY,
                group_buy_id INTEGER NOT NULL REFERENCES group_buys(id),
                creator_user_id INTEGER NOT NULL REFERENCES users(id),
                status INTEGER NOT NULL DEFAULT 0,
                expire_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )""",
            """CREATE TABLE IF NOT EXISTS group_buy_members (
                id SERIAL PRIMARY KEY,
                team_id INTEGER NOT NULL REFERENCES group_buy_teams(id),
                user_id INTEGER REFERENCES users(id),
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                is_virtual BOOLEAN NOT NULL DEFAULT FALSE,
                virtual_nickname VARCHAR(64) DEFAULT '',
                virtual_avatar VARCHAR(255) DEFAULT '',
                paid_amount NUMERIC(10,2) DEFAULT 0,
                recharge_request_id INTEGER REFERENCES recharge_requests(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(team_id, user_id)
            )""",
            "CREATE INDEX IF NOT EXISTS idx_group_buy_teams_group_buy_status ON group_buy_teams(group_buy_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_group_buy_teams_expire_at ON group_buy_teams(expire_at)",
            "CREATE INDEX IF NOT EXISTS idx_group_buy_members_team ON group_buy_members(team_id)",
            "CREATE INDEX IF NOT EXISTS idx_group_buy_members_user ON group_buy_members(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_group_buy_members_recharge ON group_buy_members(recharge_request_id)",
        ]
            for sql in statements:
                conn.execute(sql)

        # 迁移：llm_models 旧列名 context_tokens/output_tokens → max_input_tokens/max_output_tokens
            if _column_exists(conn, "llm_models", "context_tokens"):
                conn.execute("ALTER TABLE llm_models RENAME COLUMN context_tokens TO max_input_tokens")
            if _column_exists(conn, "llm_models", "output_tokens"):
                conn.execute("ALTER TABLE llm_models RENAME COLUMN output_tokens TO max_output_tokens")
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS input_price_per_million NUMERIC(12,4)")
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS output_price_per_million NUMERIC(12,4)")
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS price_currency VARCHAR(8) NOT NULL DEFAULT 'usd'")
            # 迁移：按 token 量扣费的 4 个单价字段（每 1K token 对应点数；NULL 表示未配置，回退按次扣费）
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS points_per_1k_input NUMERIC(10,4)")
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS points_per_1k_output NUMERIC(10,4)")
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS points_per_1k_cache_read NUMERIC(10,4)")
            conn.execute("ALTER TABLE llm_models ADD COLUMN IF NOT EXISTS points_per_1k_cache_creation NUMERIC(10,4)")

        # llm_models 种子数据（放在列名迁移之后，保证新旧库都兼容）
            conn.execute("""INSERT INTO llm_models (model_id, label, protocol, max_input_tokens, max_output_tokens, reasoning_efforts, default_reasoning_effort, thinking_default, context_budget_chars, input_price_per_million, output_price_per_million, price_currency, notes) VALUES
                ('deepseek-v4-flash', 'DeepSeek V4 Flash', 'openai', 1000000, 384000, '["auto","low","medium","high","max","xhigh"]'::jsonb, 'auto', 'enabled', 256000, 1, 2, 'cny', '官方 1M 上下文/384K 输出；medium/xhigh 兼容映射为 high；价格：输入 1 元/百万（缓存未命中）'),
                ('deepseek-v4-pro', 'DeepSeek V4 Pro', 'openai', 1000000, 384000, '["auto","low","high","max"]'::jsonb, 'auto', 'enabled', 256000, 3, 6, 'cny', '目前仅 high/max 两档（low 按 high、xhigh 按 max 处理）；价格：输入 3 元/百万'),
                ('gpt-5.5', 'GPT-5.5', 'openai', 1050000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 5, 30, 'usd', ''),
                ('gpt-5.5-pro', 'GPT-5.5 Pro', 'openai', 1050000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 30, 180, 'usd', ''),
                ('gpt-5.6', 'GPT-5.6', 'openai', 1050000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 5, 30, 'usd', ''),
                ('gpt-5.6-luna', 'GPT-5.6 Luna', 'openai', 1050000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 0.2, 1.2, 'usd', '轻量档，价格优势明显'),
                ('gpt-5.6-terra', 'GPT-5.6 Terra', 'openai', 1050000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 2, 12, 'usd', ''),
                ('gpt-5.6-sol', 'GPT-5.6 Sol', 'openai', 1050000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 5, 30, 'usd', ''),
                ('kimi-k3', 'Kimi K3', 'openai', 1000000, 64000, '["auto","low","high","max"]'::jsonb, 'max', 'always', 256000, NULL, NULL, 'usd', '始终推理；官方档位 low/high/max 默认 max；输出限制与价格以官方文档为准'),
                ('kimi-k2.7-code', 'Kimi K2.7 Code', 'openai', 256000, 64000, '["auto"]'::jsonb, 'auto', 'always', 256000, NULL, NULL, 'usd', 'Coding 模型，仅思考模式，256K 上下文；另有 HighSpeed 高速版；价格以官方文档为准'),
                ('minimax-m2.5', 'MiniMax M2.5', 'openai', 1000000, 8192, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 0.3, 1.2, 'usd', ''),
                ('minimax-m3', 'MiniMax M3', 'openai', 1000000, 128000, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 0.3, 1.2, 'usd', '2026 旗舰'),
                ('claude-sonnet-5', 'Claude Sonnet 5', 'anthropic', 1000000, 128000, '["auto","low","medium","high","max","xhigh"]'::jsonb, 'auto', 'enabled', 256000, 2, 10, 'usd', ''),
                ('claude-opus-5', 'Claude Opus 5', 'anthropic', 1000000, 128000, '["auto","low","medium","high","max","xhigh"]'::jsonb, 'auto', 'enabled', 256000, 5, 25, 'usd', ''),
                ('claude-haiku-4-5', 'Claude Haiku 4.5', 'anthropic', 200000, 64000, '["auto","low","medium","high","max","xhigh"]'::jsonb, 'auto', 'enabled', 200000, 1, 5, 'usd', '轻量档'),
                ('grok-4', 'Grok 4', 'openai', 256000, 256000, '["auto","low","high","max"]'::jsonb, 'auto', 'enabled', 256000, 3, 15, 'usd', ''),
                ('grok-4.5', 'Grok 4.5', 'openai', 500000, 500000, '["auto","low","high","max"]'::jsonb, 'auto', 'enabled', 256000, 2, 6, 'usd', ''),
                ('grok-code-fast-1', 'Grok Code Fast 1', 'openai', 256000, 256000, '["auto","low","high","max"]'::jsonb, 'auto', 'enabled', 256000, 0.2, 1.5, 'usd', 'Coding 专用'),
                ('qwen3-coder-plus', 'Qwen3 Coder Plus', 'openai', 997952, 65536, '["auto","low","high","max"]'::jsonb, 'auto', 'enabled', 256000, NULL, NULL, 'cny', 'Coding 模型（百炼平台）；价格以官方计费为准'),
                ('qwen3.7-max', 'Qwen3.7 Max', 'openai', 991808, 65536, '["auto","low","medium","high","max"]'::jsonb, 'auto', 'enabled', 256000, 2.5, 7.5, 'usd', '2026 新旗舰'),
                ('mimo-v2.5', '小米 MiMo 2.5', 'openai', 128000, 16384, '["auto","low","high","max"]'::jsonb, 'auto', 'enabled', 128000, NULL, NULL, 'cny', '小米 MiMo；2026 Coding 版模型 ID 与价格以官方为准')
            ON CONFLICT (model_id) DO UPDATE SET
                label = EXCLUDED.label, protocol = EXCLUDED.protocol,
                max_input_tokens = EXCLUDED.max_input_tokens, max_output_tokens = EXCLUDED.max_output_tokens,
                reasoning_efforts = EXCLUDED.reasoning_efforts,
                default_reasoning_effort = EXCLUDED.default_reasoning_effort,
                thinking_default = EXCLUDED.thinking_default,
                context_budget_chars = EXCLUDED.context_budget_chars,
                input_price_per_million = EXCLUDED.input_price_per_million,
                output_price_per_million = EXCLUDED.output_price_per_million,
                price_currency = EXCLUDED.price_currency,
                notes = EXCLUDED.notes""")

        # 唯一索引需要条件判断（source 可能为 NULL）
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_source ON prompts(source) WHERE source IS NOT NULL"
            )

        # 迁移：给 square_images 添加 category 字段
            if not _column_exists(conn, "square_images", "category"):
                conn.execute("ALTER TABLE square_images ADD COLUMN category VARCHAR(64)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_square_images_category ON square_images(category)")

        # 迁移：给 square_images 添加 is_frozen 字段
            if not _column_exists(conn, "square_images", "is_frozen"):
                conn.execute("ALTER TABLE square_images ADD COLUMN is_frozen BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "prompts", "is_frozen"):
                conn.execute("ALTER TABLE prompts ADD COLUMN is_frozen BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "prompts", "is_deleted"):
                conn.execute("ALTER TABLE prompts ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "image_metadata", "expires_at"):
                conn.execute("ALTER TABLE image_metadata ADD COLUMN expires_at TIMESTAMP")
            if not _column_exists(conn, "image_metadata", "is_permanent"):
                conn.execute("ALTER TABLE image_metadata ADD COLUMN is_permanent BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "tasks", "points_cost"):
                conn.execute("ALTER TABLE tasks ADD COLUMN points_cost NUMERIC(18,4) DEFAULT 0")
            if not _column_exists(conn, "tasks", "points_balance_after"):
                conn.execute("ALTER TABLE tasks ADD COLUMN points_balance_after NUMERIC(18,4)")
            if not _column_exists(conn, "tasks", "is_deleted"):
                conn.execute("ALTER TABLE tasks ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "tasks", "deleted_at"):
                conn.execute("ALTER TABLE tasks ADD COLUMN deleted_at TIMESTAMP")
            if not _column_exists(conn, "tasks", "deleted_by_role"):
                conn.execute("ALTER TABLE tasks ADD COLUMN deleted_by_role VARCHAR(16)")
            if not _column_exists(conn, "point_transactions", "request_key"):
                conn.execute("ALTER TABLE point_transactions ADD COLUMN request_key VARCHAR(128)")
            if not _column_exists(conn, "point_transactions", "model_id"):
                conn.execute("ALTER TABLE point_transactions ADD COLUMN model_id VARCHAR(128)")
            if not _column_exists(conn, "recharge_requests", "risk_level"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN risk_level VARCHAR(16) DEFAULT 'low'")
            if not _column_exists(conn, "recharge_requests", "risk_flags"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN risk_flags JSONB DEFAULT '[]'::jsonb")
            if not _column_exists(conn, "generation_finance_entries", "quota_shortage"):
                conn.execute("ALTER TABLE generation_finance_entries ADD COLUMN quota_shortage NUMERIC(18,6) DEFAULT 0")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_image_metadata_expires_at ON image_metadata(expires_at)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_image_metadata_is_permanent ON image_metadata(is_permanent)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_is_deleted ON tasks(is_deleted)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_prompts_is_deleted ON prompts(is_deleted)")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_point_tx_request_key ON point_transactions(request_key) WHERE request_key IS NOT NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_client_req ON tasks(user_id, ((params->>'client_request_id'))) WHERE params ? 'client_request_id'")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_target ON favorites(user_id,target_type,target_id)")
            conn.execute("UPDATE image_metadata m SET is_permanent = TRUE, expires_at = NULL WHERE EXISTS (SELECT 1 FROM square_images s WHERE s.filename = m.filename)")
            conn.execute("UPDATE image_metadata SET expires_at = COALESCE(created_at, NOW()) + interval '2 day' WHERE is_permanent = FALSE AND expires_at IS NULL")
            conn.execute("UPDATE image_metadata SET expires_at = created_at + interval '2 day' WHERE is_permanent = FALSE AND expires_at IS NOT NULL AND expires_at > NOW() + interval '1 day' AND expires_at <= NOW() + interval '3 day'")
            if not _column_exists(conn, "users", "email"):
                conn.execute("ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT ''")
            if not _column_exists(conn, "users", "invite_code"):
                conn.execute("ALTER TABLE users ADD COLUMN invite_code VARCHAR(32)")
            if not _column_exists(conn, "users", "invite_code_created_at"):
                conn.execute("ALTER TABLE users ADD COLUMN invite_code_created_at TIMESTAMP")
            if not _column_exists(conn, "users", "inviter_user_id"):
                conn.execute("ALTER TABLE users ADD COLUMN inviter_user_id INTEGER REFERENCES users(id)")
            if not _column_exists(conn, "users", "register_invite_code"):
                conn.execute("ALTER TABLE users ADD COLUMN register_invite_code VARCHAR(32) DEFAULT ''")
            if not _column_exists(conn, "users", "invited_at"):
                conn.execute("ALTER TABLE users ADD COLUMN invited_at TIMESTAMP")
            if not _column_exists(conn, "users", "ai_daily_quota_remaining"):
                conn.execute("ALTER TABLE users ADD COLUMN ai_daily_quota_remaining INTEGER DEFAULT 0")
            if not _column_exists(conn, "users", "ai_daily_quota_date"):
                conn.execute("ALTER TABLE users ADD COLUMN ai_daily_quota_date DATE")
            if not _column_exists(conn, "users", "ai_daily_quota_total"):
                conn.execute("ALTER TABLE users ADD COLUMN ai_daily_quota_total INTEGER")
            if not _column_exists(conn, "recharge_requests", "invite_code"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN invite_code VARCHAR(32) DEFAULT ''")
            if not _column_exists(conn, "recharge_requests", "plan_id"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN plan_id INTEGER REFERENCES subscription_plans(id)")
            # 套餐级拼团开关：默认关闭，admin 在套餐编辑中开启后才能创建拼团活动
            if not _column_exists(conn, "subscription_plans", "allow_group_buy"):
                conn.execute("ALTER TABLE subscription_plans ADD COLUMN allow_group_buy BOOLEAN NOT NULL DEFAULT FALSE")
            if not _column_exists(conn, "recharge_requests", "submit_ip"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN submit_ip VARCHAR(45) DEFAULT ''")
            if not _column_exists(conn, "recharge_requests", "inviter_user_id"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN inviter_user_id INTEGER REFERENCES users(id)")
            if not _column_exists(conn, "recharge_requests", "invite_discount_percent_snapshot"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN invite_discount_percent_snapshot NUMERIC(10,4) DEFAULT 0")
            if not _column_exists(conn, "recharge_requests", "invite_rebate_percent_snapshot"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN invite_rebate_percent_snapshot NUMERIC(10,4) DEFAULT 0")
            if not _column_exists(conn, "recharge_requests", "invite_bonus_points"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN invite_bonus_points INTEGER DEFAULT 0")
            if not _column_exists(conn, "recharge_requests", "invite_rebate_points"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN invite_rebate_points INTEGER DEFAULT 0")
            if not _column_exists(conn, "recharge_requests", "user_confirmed"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN user_confirmed BOOLEAN DEFAULT FALSE")
            if not _column_exists(conn, "recharge_requests", "confirmed_at"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN confirmed_at TIMESTAMP")
            if not _column_exists(conn, "recharge_requests", "discount"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN discount NUMERIC(4,2) DEFAULT 0")
            if not _column_exists(conn, "recharge_requests", "group_buy_team_id"):
                conn.execute("ALTER TABLE recharge_requests ADD COLUMN group_buy_team_id INTEGER REFERENCES group_buy_teams(id)")
            # 昵称允许重名（账号 username 仍唯一），历史唯一索引幂等移除
            conn.execute("DROP INDEX IF EXISTS idx_users_nickname_unique")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code_unique ON users(invite_code) WHERE invite_code IS NOT NULL AND invite_code<>''")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_users_inviter_user_id ON users(inviter_user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_recharge_inviter_user_id ON recharge_requests(inviter_user_id)")
            # 账本统一保留 4 位小数；历史整数值保持原值，不做单位换算。
            for table, column in (
                ("users", "points"), ("point_transactions", "amount"),
                ("point_transactions", "balance_after"), ("tasks", "points_cost"),
                ("tasks", "points_balance_after"), ("chat_usage_records", "charged_points"),
                ("chat_usage_records", "subscription_points_used"), ("chat_usage_records", "wallet_points_used"),
                ("subscription_plans", "grant_points"), ("subscription_cycles", "granted_points"),
                ("subscription_cycles", "remaining_points"), ("point_buckets", "granted_points"),
                ("point_buckets", "remaining_points"), ("point_transaction_allocations", "amount"),
            ):
                conn.execute(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE NUMERIC(18,4) USING ROUND({column}::numeric, 4)")

            conn.execute(
                """INSERT INTO subscription_plans
                   (code, name, description, price_rmb, cycle_days, grant_points, features, allowed_models, is_free, sort_order)
                   VALUES ('free', '免费套餐', '基础对话能力，按需使用永久积分。', 0, 30, 0,
                           '{"web_search": true, "file_upload": true, "file_write": true, "max_chat_sessions": 100, "max_chat_files": 20}'::jsonb,
                           '[]'::jsonb, TRUE, 0)
                   ON CONFLICT (code) DO NOTHING"""
            )
            # 参考套餐（会员订阅 + 永久积分包）与文案迁移：仅首次初始化时执行一次。
            # 一次性同步：2026-08-14 已把本地套餐同步到服务器；此后服务器套餐以数据库/
            # 管理后台为准，启动不再覆盖（防止管理员后续改价/改文案/改周期被种子还原）。
            paid_count = conn.execute(
                "SELECT COUNT(*) AS cnt FROM subscription_plans WHERE is_free = FALSE"
            ).fetchone()["cnt"]
            if paid_count == 0:
                conn.execute(
                    """INSERT INTO subscription_plans
                       (code, name, description, price_rmb, cycle_days, grant_points, features, allowed_models, is_free, sort_order)
                       VALUES
                       ('member-day', '日卡', 'AI 助手专用，当天高额对话。', 9.9, 1, 0,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "membership", "daily_quota": 60, "original_price_rmb": "9.9"}'::jsonb, '[]'::jsonb, FALSE, 1),
                       ('member-month', '月卡', 'AI 助手专用，30 天每日高额对话。', 89.9, 30, 0,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "membership", "daily_quota": 100, "original_price_rmb": "99.9"}'::jsonb, '[]'::jsonb, FALSE, 2),
                       ('member-year', '年卡', 'AI 助手专用，365 天畅享，抢先体验新模型。', 199, 365, 0,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "membership", "daily_quota": 200, "original_price_rmb": "399"}'::jsonb, '[]'::jsonb, FALSE, 3),
                       ('member-permanent', '永久卡', 'AI 助手专用，一次购买长期使用，抢先体验新模型。', 299, 36500, 50,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "membership", "daily_quota": null, "original_price_rmb": "599"}'::jsonb, '[]'::jsonb, FALSE, 4),
                       ('credits-50', '积分体验包', '通用积分，永久有效，50 积分。', 9.9, 36500, 50,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "credits", "original_price_rmb": "19.9"}'::jsonb, '[]'::jsonb, FALSE, 5),
                       ('credits-500', '积分基础包', '通用积分，永久有效，500 积分。', 88, 36500, 500,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "credits", "original_price_rmb": "99"}'::jsonb, '[]'::jsonb, FALSE, 6),
                       ('credits-1000', '积分标准包', '通用积分，永久有效，1000 积分。', 168, 36500, 1000,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "credits", "original_price_rmb": "199"}'::jsonb, '[]'::jsonb, FALSE, 7),
                       ('credits-3000', '积分豪华包', '通用积分，永久有效，3000 积分。', 468, 36500, 3000,
                        '{"web_search": true, "file_upload": true, "file_write": true, "package_type": "credits", "original_price_rmb": "599"}'::jsonb, '[]'::jsonb, FALSE, 8)
                       ON CONFLICT (code) DO NOTHING"""
                )
                # 文案统一：去掉「PPT 专用」，聊天→AI 助手（仅首次初始化执行）
                conn.execute(
                    """UPDATE subscription_plans
                       SET description = REPLACE(description, '聊天、PPT 专用', 'AI 助手专用'),
                           updated_at = NOW()
                       WHERE description LIKE '%聊天、PPT 专用%'"""
                )
                # 文案统一：助手专用 → AI 助手专用（仅首次初始化执行；排除已替换行避免重复叠加前缀）
                conn.execute(
                    """UPDATE subscription_plans
                       SET description = REPLACE(description, '助手专用', 'AI 助手专用'),
                           updated_at = NOW()
                       WHERE description LIKE '%助手专用%'
                         AND description NOT LIKE '%AI 助手专用%'"""
                )
                # 积分包通用化 + 永久化（仅首次初始化执行）：描述去掉「AI 绘画专用」改为
                # 通用积分、包名去掉「画图」；cycle_days 统一 36500（与 member-permanent 同一约定）
                conn.execute(
                    """UPDATE subscription_plans
                       SET description = REPLACE(REPLACE(description, 'AI 绘画专用，', '通用积分，永久有效，'), '画图专用，', '通用积分，永久有效，'),
                           name = REPLACE(name, '画图积分', '积分'),
                           updated_at = NOW()
                       WHERE features->>'package_type' = 'credits'
                         AND description NOT LIKE '%通用积分%'"""
                )
                conn.execute(
                    """UPDATE subscription_plans
                       SET cycle_days = 36500, updated_at = NOW()
                       WHERE features->>'package_type' = 'credits' AND cycle_days IS DISTINCT FROM 36500"""
                )
            # free 权益与付费对齐（功能全开：联网搜索/文件上传/文件写入/工具调用），
            # 仅保留未来做模型限制与积分限制的余地；幂等刷新已有库
            conn.execute(
                """UPDATE subscription_plans
                   SET features = '{"web_search": true, "file_upload": true, "file_write": true, "max_chat_sessions": 100, "max_chat_files": 20}'::jsonb,
                       updated_at = NOW()
                   WHERE is_free = TRUE AND features <> '{"web_search": true, "file_upload": true, "file_write": true, "max_chat_sessions": 100, "max_chat_files": 20}'::jsonb"""
            )
            # 存量免费用户周期快照同步刷新（权益读取走 entitlements_snapshot，需一并迁移才立即生效）
            conn.execute(
                """UPDATE subscription_cycles c
                   SET entitlements_snapshot = jsonb_build_object(
                         'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description,
                         'price_rmb', p.price_rmb::text, 'cycle_days', p.cycle_days, 'grant_points', p.grant_points,
                         'features', p.features, 'allowed_models', p.allowed_models,
                         'max_concurrent_requests', COALESCE(p.max_concurrent_requests, 1), 'is_free', p.is_free)
                   FROM subscription_plans p
                   WHERE c.plan_id = p.id AND p.is_free = TRUE AND c.status = 'active'
                     AND c.entitlements_snapshot->'features' IS DISTINCT FROM p.features"""
            )
            # 多订阅卡支持：去掉 user_subscriptions.user_id 唯一约束（一行 = 一张订阅卡，
            # 各自独立倒计时；生效时优先价格最高的卡）。历史数据每用户 1 行保持原样。
            sub_uniq = conn.execute(
                """SELECT conname FROM pg_constraint
                   WHERE conrelid = 'user_subscriptions'::regclass AND contype = 'u'
                     AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                         WHERE attrelid = 'user_subscriptions'::regclass AND attname = 'user_id')]"""
            ).fetchone()
            if sub_uniq:
                conn.execute(f'ALTER TABLE user_subscriptions DROP CONSTRAINT {sub_uniq["conname"]}')
            # 历史积分包产生的订阅卡行：过期处理（积分早已进永久桶，卡行不再参与权益选择）
            conn.execute(
                """UPDATE user_subscriptions SET status = 'expired', expires_at = NOW()
                   WHERE status = 'active'
                     AND plan_id IN (SELECT id FROM subscription_plans WHERE features->>'package_type' = 'credits')"""
            )
            # 会员卡排队冻结：pending_days > 0 表示排队/冻结中（不消耗时长、无权益、expires_at 置 NULL），
            # 轮到（贵的到期）才激活倒计时；激活中卡 pending_days = 0。
            conn.execute(
                "ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS pending_days NUMERIC(10,2) NOT NULL DEFAULT 0"
            )
            # 存量多卡冻结（幂等：WHERE pending_days = 0 保证重跑不重复处理）：每用户保留最贵一张
            # 继续生效，其余卡若有未过期周期则冻结剩余时长（周期 expire、桶清零、卡保留 active），
            # 周期已耗尽的卡直接标记 expired。
            cards = conn.execute(
                """SELECT us.id AS sub_id, us.user_id, us.current_cycle_id,
                          c.status AS cycle_status, c.period_end
                   FROM user_subscriptions us
                   JOIN subscription_plans p ON p.id = us.plan_id
                   LEFT JOIN subscription_cycles c ON c.id = us.current_cycle_id
                   WHERE us.status = 'active' AND us.pending_days = 0
                     AND p.is_free = FALSE
                     AND (p.features->>'package_type') IS DISTINCT FROM 'credits'
                   ORDER BY us.user_id, p.price_rmb DESC, us.started_at ASC"""
            ).fetchall()
            grouped = {}
            for card in cards:
                grouped.setdefault(card["user_id"], []).append(card)
            for user_cards in grouped.values():
                for card in user_cards[1:]:  # 每组第一张是最贵的（当前生效），其余卡冻结排队
                    if card["cycle_status"] == "active" and card["period_end"] and card["period_end"] > datetime.now():
                        remaining = card["period_end"] - datetime.now()
                        conn.execute(
                            "UPDATE subscription_cycles SET status = 'expired', remaining_points = 0 WHERE id = %s",
                            (card["current_cycle_id"],),
                        )
                        conn.execute(
                            "UPDATE point_buckets SET remaining_points = 0, status = 'expired' WHERE cycle_id = %s",
                            (card["current_cycle_id"],),
                        )
                        # 保留 current_cycle_id 指向已 expire 的周期便于审计；轮到激活时重新建周期
                        conn.execute(
                            "UPDATE user_subscriptions SET pending_days = %s, expires_at = NULL, current_cycle_id = %s WHERE id = %s",
                            (round(remaining.total_seconds() / 86400.0, 2), card["current_cycle_id"], card["sub_id"]),
                        )
                    else:
                        conn.execute(
                            "UPDATE user_subscriptions SET status = 'expired' WHERE id = %s",
                            (card["sub_id"],),
                        )

        # 初始化默认分类
            count = conn.execute("SELECT COUNT(*) AS cnt FROM categories").fetchone()["cnt"]
            if count == 0:
                default_categories = [
                    ("poster", "海报与插画", 1),
                    ("portrait", "人像摄影", 2),
                    ("ui", "UI设计", 3),
                    ("comparison", "模型对比", 4),
                    ("ad-creative", "广告创意", 5),
                    ("ecommerce", "电商案例", 6),
                    ("character", "角色设计", 7),
                ]
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO categories (slug, label, sort_order) VALUES (%s, %s, %s)",
                        default_categories,
                    )

        # 清理历史脏数据
            conn.execute("SAVEPOINT init_cleanup_sp")
            try:
                conn.execute("""
                    DELETE FROM user_requests WHERE status = 'processing' AND user_id IN (
                        SELECT DISTINCT user_id FROM user_requests WHERE status IN ('success', 'failed')
                    )
                """)
            except Exception:
                conn.execute("ROLLBACK TO SAVEPOINT init_cleanup_sp")
            conn.execute("RELEASE SAVEPOINT init_cleanup_sp")
        finally:
            try:
                conn.execute("SELECT pg_advisory_unlock(%s,%s)", (58231, 19001))
            except Exception:
                try:
                    conn.rollback()
                    conn.execute("SELECT pg_advisory_unlock(%s,%s)", (58231, 19001))
                except Exception:
                    pass


def create_admin_if_not_exists():
    import os
    import bcrypt

    admin_username = os.getenv("ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD")
    if not admin_username or not admin_password:
        print("[WARNING] ADMIN_USERNAME 或 ADMIN_PASSWORD 未设置，跳过管理员创建")
        return
    if not re.fullmatch(r"[A-Za-z0-9_]{4,16}", admin_username):
        print("[WARNING] ADMIN_USERNAME 需为4到16位字母、数字或下划线，跳过管理员创建")
        return
    with get_db() as conn:
        admin = conn.execute(
            "SELECT id FROM users WHERE username = %s", (admin_username,)
        ).fetchone()
        if not admin:
            password_hash = bcrypt.hashpw(admin_password.encode(), bcrypt.gensalt()).decode()
            conn.execute(
                "INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (%s, %s, %s, %s)",
                (admin_username, password_hash, "管理员", True),
            )


init_pool()
init_db()
create_admin_if_not_exists()
