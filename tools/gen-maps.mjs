// 合成猫隐村地图静态数据：原型坐标（测试/游戏主界面.html MAPS）× NPC 全量数据
// 输出：server/data/maps.json
import { readFileSync, writeFileSync } from "node:fs";

const npcSource = JSON.parse(
  readFileSync(new URL("../docs/猫隐村NPC全量数据.json", import.meta.url), "utf8"),
);

// 坐标 = 原型 MAPS.猫隐村.locs 标签中心（对官方预览图校准）
const LOCS = [
  { code: "jiedaobanshichu", name: "街道办事处", short: "街道办", x: 213, y: 157, key: "街道办事处" },
  { code: "cunzhangxiaowu", name: "村长小屋", short: "村长小屋", x: 306, y: 116, key: "村长小屋" },
  { code: "zhuangbeidian", name: "装备店", short: "装备店", x: 412, y: 160, key: "装备店" },
  { code: "jiaotang", name: "教堂", short: "教堂", x: 561, y: 178, key: "教堂" },
  { code: "hocunxiaodao", name: "后村小道", short: "后村小道", x: 298, y: 198, key: "后村小道" },
  { code: "maoyincunxiaojing", name: "猫隐村小径", short: "猫隐村小径", x: 244, y: 366, key: "猫隐村小径" },
  { code: "biwuchang", name: "比武场", short: "比武场", x: 118, y: 196, key: "比武场" },
  { code: "guangchang", name: "猫隐村广场", short: "猫隐村广场", x: 341, y: 340, key: "猫隐村广场" },
  { code: "cunkou", name: "村口", short: "村口", x: 338, y: 494, key: "村口" },
  { code: "daojudian", name: "道具店", short: "道具店", x: 435, y: 270, key: "道具店" },
  { code: "chongwutueryuansuo", name: "宠物托儿所", short: "宠物托儿所", x: 70, y: 293, key: "宠物托儿所" },
  { code: "chongwuyanjiusuo", name: "宠物研究所", short: "宠物研究所", x: 470, y: 499, key: "宠物研究所" },
  { code: "cangku", name: "仓库", short: "仓库", x: 522, y: 419, key: "仓库" },
  { code: "guangchangxiaodao", name: "广场小道", short: "广场小道", x: 444, y: 379, key: "广场小道" },
  { code: "hocunlindi", name: "后村林地", short: "后村林地", x: 173, y: 53, key: "后村林地" },
  { code: "hocungudi", name: "后村谷地", short: "后村谷地", x: 76, y: 90, key: "后村谷地" },
  { code: "chibianxiaodao", name: "池边小道", short: "池边小道", x: 241, y: 292, key: "池边小道" },
  { code: "yizhan", name: "猫隐村驿站", short: "驿站", x: 210, y: 449, key: "猫隐村驿站" },
  { code: "muye03", name: "牧野草原03", short: "牧野草原", x: 374, y: 570, key: "牧野草原03", locked: true, lockedReason: "牧野草原将在下一切片开放" },
  { code: "xicunkou", name: "西村口", short: "西村口", x: 215, y: 538, key: "西村口" },
];

const nodes = LOCS.map((loc) => {
  const src = npcSource[loc.key]?.npcs ?? [];
  return {
    code: loc.code,
    name: loc.name,
    short: loc.short,
    x: loc.x,
    y: loc.y,
    ...(loc.locked ? { locked: true, lockedReason: loc.lockedReason } : {}),
    npcs: src.map((n) => ({
      name: n.name.replace(/<[^>]+>/g, ""),
      title: (n.title ?? "").replace(/<[^>]+>/g, ""),
      titleColor: n.title_color ?? "",
    })),
  };
});

const out = {
  maps: [
    {
      code: "maoyin_village",
      name: "猫隐村",
      type: "town",
      background: "/maps/maoyin.jpg",
      spawnNodeCode: "guangchang",
      nodes,
    },
  ],
};

writeFileSync(new URL("../server/data/maps.json", import.meta.url), JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`生成完成：${nodes.length} 节点，NPC 合计 ${nodes.reduce((s, n) => s + n.npcs.length, 0)} 名`);
