-- ============================================================
-- 《喵游记》运行时数据库 002：聊天消息
-- 频道 area/world/private 开放；guild/team 枚举预留（对应系统二期）。
-- 时区：UTC（与 001 口径一致）
-- ============================================================

USE maoyouji;

CREATE TABLE chat_messages (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY COMMENT '自增主键（前端轮询游标）',
  channel      ENUM('area','world','private','guild','team') NOT NULL COMMENT '频道：区域/世界/私聊/公会(预留)/队伍(预留)',
  sender_id    BIGINT UNSIGNED NOT NULL COMMENT '发送者角色 id',
  sender_name  VARCHAR(32)  NOT NULL COMMENT '发送者角色名快照（发送时取，免 join）',
  target_id    BIGINT UNSIGNED NULL COMMENT '私聊目标角色 id（仅 private）',
  target_name  VARCHAR(32)  NULL COMMENT '私聊目标角色名快照（仅 private）',
  node_code    VARCHAR(64)  NULL COMMENT '区域聊地图节点编码（仅 area）',
  content      VARCHAR(60)  NOT NULL COMMENT '消息内容（1~60 字，应用层校验）',
  created_at   DATETIME(0)  NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间（UTC）',
  INDEX idx_chat_sender_channel_time (sender_id, channel, created_at) COMMENT '世界聊限频查',
  INDEX idx_chat_node_id (node_code, id) COMMENT '区域聊轮询',
  INDEX idx_chat_target_id (target_id, id) COMMENT '私聊轮询',
  CONSTRAINT fk_chat_sender FOREIGN KEY (sender_id) REFERENCES characters (id),
  CONSTRAINT fk_chat_target FOREIGN KEY (target_id) REFERENCES characters (id)
) ENGINE=InnoDB COMMENT='聊天消息';
