-- ============================================================
-- 《喵游记》运行时数据库 003：战斗与每格怪物实例
-- battles 持久化战斗状态快照（state JSON，惰性结算，服务器零定时器）；
-- map_node_monsters 每格怪物实例（进入格子惰性生成）。
-- 建表顺序：先 map_node_monsters（被 battles 外键引用）。
-- 时区：UTC（与 001 口径一致）
-- ============================================================

USE maoyouji;

-- ① 先建：每格怪物实例（进入格子惰性生成，无外键，应用层兜底校验）------

CREATE TABLE map_node_monsters (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  map_code     VARCHAR(64) NOT NULL COMMENT '地图编码（静态数据 maps.json 键）',
  node_code    VARCHAR(64) NOT NULL COMMENT '节点编码（静态数据 maps.json 内节点键）',
  monster_code VARCHAR(64) NOT NULL COMMENT '怪物编码（静态数据 monsters.json 键）',
  hp           SMALLINT UNSIGNED NOT NULL COMMENT '当前 HP（生成时在静态区间内随机）',
  max_hp       SMALLINT UNSIGNED NOT NULL COMMENT 'HP 上限',
  status       ENUM('alive','dead') NOT NULL DEFAULT 'alive' COMMENT '存活/死亡',
  respawn_at   DATETIME(0) NULL COMMENT '复活时间（死亡后 30s；NULL=存活或未排程）',
  created_at   DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at   DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  INDEX idx_mnm_node (map_code, node_code, status) COMMENT '按格查活怪/惰性复活'
) ENGINE=InnoDB COMMENT='每格怪物实例';

-- ② 后建：战斗（惰性结算，状态在 state JSON；服务器零定时器）----------

CREATE TABLE battles (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键',
  character_id        BIGINT UNSIGNED NOT NULL COMMENT '参战角色 id',
  monster_instance_id BIGINT UNSIGNED NOT NULL COMMENT '怪物实例 id（map_node_monsters 键）',
  monster_code        VARCHAR(64) NOT NULL COMMENT '怪物编码快照（静态数据 monsters.json 键）',
  status              ENUM('active','finished') NOT NULL DEFAULT 'active' COMMENT '进行中/已结束',
  result              ENUM('victory','defeat','draw') NULL COMMENT '胜负（结束时有值）',
  state               JSON NOT NULL COMMENT '战斗状态快照（src/game/engine.ts BattleState）：种子RNG/双方数值/时间线/事件流/待发技能/CD',
  started_at          DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '开战时间（UTC）',
  ended_at            DATETIME(0) NULL COMMENT '结束时间（UTC）',
  created_at          DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间（UTC）',
  updated_at          DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间（UTC）',
  INDEX idx_battles_character (character_id, status) COMMENT '查角色当前 active 战斗（同一角色最多一场由应用层事务保证，不建唯一键）',
  CONSTRAINT fk_battles_character FOREIGN KEY (character_id) REFERENCES characters (id),
  CONSTRAINT fk_battles_monster  FOREIGN KEY (monster_instance_id) REFERENCES map_node_monsters (id)
) ENGINE=InnoDB COMMENT='战斗（惰性结算）';
