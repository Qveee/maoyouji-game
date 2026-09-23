-- ============================================================
-- 《喵游记》运行时数据库 004：装备绑定状态
-- 装备默认「装备后绑定」(bind_on_equip)，穿戴确认后转「已绑定」(bound)；
-- 只有 bind_on_equip 状态的装备可交易（交易系统为二期，本列先行做状态地基）。
-- VARCHAR code 惯例（同 characters.profession 风格）：取值校验与中文映射
-- 由应用层负责（server inventory 路由 / web api.ts），不用中文/枚举存值。
-- 存量行经 DEFAULT 自动落 bind_on_equip（语义：既有装备视为可交易）。
-- ============================================================

USE maoyouji;

ALTER TABLE character_inventory
  ADD COLUMN bind_state VARCHAR(20) NOT NULL DEFAULT 'bind_on_equip'
    COMMENT '绑定状态：bind_on_equip=装备后绑定（可交易）/ bound=已绑定（不可交易）'
    AFTER durability;
