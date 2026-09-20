-- ============================================================
-- 《喵游记》运行时数据库 001（共识 v1.0 改造版）
-- 适用：MySQL 8.0.16+ / utf8mb4 / InnoDB / 单服单库
-- 范围：仅运行时状态。静态配置（宠物/道具/装备/怪物/技能/
--       地图/NPC/任务/等级）存放于 server/data/*.json，
--       由服务启动时 zod 校验并加载，不在数据库建表。
-- 时区：全表 UTC（连接串 time_zone=+00:00，compose 已设）
-- ============================================================

CREATE DATABASE IF NOT EXISTS maoyouji
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE maoyouji;

-- ① 账号 ------------------------------------------------------

CREATE TABLE accounts (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  username      VARCHAR(32)  NOT NULL COMMENT '登录用户名（唯一）',
  password_hash VARCHAR(255) NOT NULL COMMENT 'argon2id 哈希',
  last_login_at DATETIME(0)  NULL COMMENT '最后登录时间（UTC）',
  created_at    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_accounts_username (username)
) ENGINE=InnoDB COMMENT='账号';

-- ② 角色（宠物即角色：一账号最多 5 角色，上限由应用层校验）------

CREATE TABLE characters (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  account_id          BIGINT UNSIGNED NOT NULL COMMENT '所属账号 id',
  name                VARCHAR(32)  NOT NULL COMMENT '全服唯一；软删时应用层改名释放昵称',
  profession          ENUM('warrior','mage') NOT NULL COMMENT '职业：战士/法师（创建后不可换）',
  breed_code          VARCHAR(64)  NOT NULL COMMENT '宠物品种编码（静态数据 pets.json 键）',
  active_skill_line   VARCHAR(64)  NULL COMMENT '当前激活的职业技能系编码（静态数据 skill-lines 键），NULL=未激活',
  level               TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '等级 1~90',
  exp                 BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前等级内经验',
  vit                 SMALLINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '体力（五维之一，存当前总值=初始+成长）',
  str                 SMALLINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '力量',
  agi                 SMALLINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '敏捷',
  intel               SMALLINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '智力（int 为关键字，列名用 intel）',
  spr                 SMALLINT UNSIGNED NOT NULL DEFAULT 5 COMMENT '精神',
  hp                  INT UNSIGNED NOT NULL DEFAULT 50 COMMENT '当前 HP（战斗外惰性恢复锚点）',
  sp                  INT UNSIGNED NOT NULL DEFAULT 30 COMMENT '当前 SP',
  resources_updated_at DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'HP/SP 最后结算时间（UTC），恢复量按此后时间差补算',
  copper              BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '货币（最小单位铜币；金/银为展示换算）',
  current_node_code   VARCHAR(64)  NULL COMMENT '当前所在地图节点编码（静态数据 maps.json 键）',
  deleted_at          DATETIME(0)  NULL COMMENT '软删除时间',
  created_at          DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at          DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_characters_name (name),
  INDEX idx_characters_account (account_id),
  CONSTRAINT chk_characters_level CHECK (level BETWEEN 1 AND 90),
  CONSTRAINT fk_characters_account FOREIGN KEY (account_id) REFERENCES accounts (id)
) ENGINE=InnoDB COMMENT='角色（宠物即角色）';

-- ③ 已学技能 --------------------------------------------------

CREATE TABLE character_skills (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id BIGINT UNSIGNED NOT NULL COMMENT '所属角色 id',
  skill_code   VARCHAR(64)  NOT NULL COMMENT '技能编码（静态数据 skills.json 键）',
  skill_level  TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '技能等级（上限=角色等级，应用层校验）',
  learned_at   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '学会时间（UTC）',
  created_at   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_skills (character_id, skill_code),
  CONSTRAINT fk_character_skills_character FOREIGN KEY (character_id) REFERENCES characters (id)
) ENGINE=InnoDB COMMENT='角色已学技能';

-- ④ 背包（格子制 300 格，容量应用层校验；已穿戴装备 slot_index 为 NULL）------

CREATE TABLE character_inventory (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id   BIGINT UNSIGNED NOT NULL COMMENT '所属角色 id',
  item_code      VARCHAR(64)  NOT NULL COMMENT '道具编码（静态数据 items.json 键，装备亦有装备扩展）',
  slot_index     SMALLINT UNSIGNED NULL COMMENT '背包格序号 0~299；NULL=已穿戴',
  quantity       SMALLINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '堆叠数量（装备=1）',
  enhance_level  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '强化等级（装备）',
  durability     SMALLINT UNSIGNED NULL COMMENT '当前耐久（装备；NULL=非装备）',
  affixes        JSON NULL COMMENT '随机词条（装备），如 [{"attr":"crit_perc","value":3}]',
  created_at     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_inventory_slot (character_id, slot_index),
  INDEX idx_character_inventory_item (character_id, item_code),
  CONSTRAINT fk_character_inventory_character FOREIGN KEY (character_id) REFERENCES characters (id)
) ENGINE=InnoDB COMMENT='角色背包';

-- ⑤ 装备位（12 部位；部位为静态配置，slot_code 引用之）----------

CREATE TABLE character_equipment (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id  BIGINT UNSIGNED NOT NULL COMMENT '所属角色 id',
  slot_code     VARCHAR(32)  NOT NULL COMMENT '部位编码（静态数据装备部位，如 main_hand/chest）',
  inventory_id  BIGINT UNSIGNED NOT NULL COMMENT '穿戴中的背包行 id（全局唯一：一件装备只能穿一处）',
  created_at    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at    DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_equipment_slot (character_id, slot_code),
  UNIQUE KEY uk_character_equipment_inventory (inventory_id),
  CONSTRAINT fk_character_equipment_character  FOREIGN KEY (character_id) REFERENCES characters (id),
  CONSTRAINT fk_character_equipment_inventory  FOREIGN KEY (inventory_id) REFERENCES character_inventory (id)
) ENGINE=InnoDB COMMENT='角色装备位';

-- ⑥ 商店限购计数 ----------------------------------------------

CREATE TABLE character_shop_buys (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id   BIGINT UNSIGNED NOT NULL COMMENT '所属角色 id',
  shop_item_code VARCHAR(64)  NOT NULL COMMENT '货架条目编码（静态数据 shops.json 键）',
  buy_date       DATE NOT NULL COMMENT '购买日期（按天限购）',
  buy_count      INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '当日累计购买数',
  created_at     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at     DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_shop_buys (character_id, shop_item_code, buy_date),
  CONSTRAINT fk_character_shop_buys_character FOREIGN KEY (character_id) REFERENCES characters (id)
) ENGINE=InnoDB COMMENT='商店限购计数';

-- ⑦ 角色任务（周期任务 cycle_key：日常=日期、周常=ISO 周、非周期=''）------

CREATE TABLE character_quests (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id BIGINT UNSIGNED NOT NULL COMMENT '所属角色 id',
  quest_code   VARCHAR(64)  NOT NULL COMMENT '任务编码（静态数据 quests.json 键）',
  status       ENUM('accepted','ready','completed','abandoned') NOT NULL DEFAULT 'accepted' COMMENT '进行中/待交付/已完成/已放弃',
  cycle_key    VARCHAR(16)  NOT NULL DEFAULT '' COMMENT '周期任务标识：2026-09-19 / 2026-W38 / 非周期空串',
  accepted_at  DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '接取时间（UTC）',
  completed_at DATETIME(0)  NULL COMMENT '完成时间（UTC）',
  created_at   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_quests (character_id, quest_code, cycle_key),
  CONSTRAINT fk_character_quests_character FOREIGN KEY (character_id) REFERENCES characters (id)
) ENGINE=InnoDB COMMENT='角色任务状态';

CREATE TABLE character_quest_progress (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_quest_id BIGINT UNSIGNED NOT NULL COMMENT '关联角色任务 id',
  objective_code     VARCHAR(64)  NOT NULL COMMENT '任务目标编码（静态数据 quests.json 内目标键）',
  current_count      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前完成计数',
  created_at         DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at         DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_quest_progress (character_quest_id, objective_code),
  CONSTRAINT fk_character_quest_progress_quest FOREIGN KEY (character_quest_id) REFERENCES character_quests (id)
) ENGINE=InnoDB COMMENT='任务目标进度';

-- ⑧ 角色怪物斩杀统计（战斗胜利 UPSERT 递增）--------------------

CREATE TABLE character_monster_stats (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id      BIGINT UNSIGNED NOT NULL COMMENT '所属角色 id',
  monster_code      VARCHAR(64)  NOT NULL COMMENT '怪物编码（静态数据 monsters.json 键）',
  kill_count        BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '该怪物累计斩杀数',
  total_exp_gained  BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '击杀该怪物累计获得经验值（实际值）',
  created_at        DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at        DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  UNIQUE KEY uk_character_monster_stats (character_id, monster_code),
  CONSTRAINT fk_character_monster_stats_character FOREIGN KEY (character_id) REFERENCES characters (id)
) ENGINE=InnoDB COMMENT='角色怪物斩杀统计';
