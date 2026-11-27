/**
 * shared/media.ts — 图片 MIME 白名单单一事实源（架构漂移治理 · BL-DOC-01 延伸）
 *
 * ── 为什么收敛 ──
 * 收敛前同一张白名单在四处逐字重复：
 *   server/http.ts(KG_IMG_MIME) / server/paperApi.ts(MIME) /
 *   server/naokuApi.ts(MIME) / adapters/tuxing.ts(MIME)。
 * 四个图片服务端点各自判 415 的口径若漂移（例如新增 .avif 只改一处），
 * 会出现「同一张图这个端点能出、那个端点 415」的假漂移——与 v1.8 遥测口径、
 * cycle-18 影子端点同族的「声明 vs 运行态不一致」事故。
 *
 * ── 纪律 ──
 * ① 本表是**唯一**扩展名→MIME 映射；任何图片服务端点必须 import 本常量，
 *    禁止在本文件之外再写第二份字面量（smoke 守卫静态断言）。
 * ② 只做纯数据映射，零 IO / 零副作用（与 shared/kernel.ts 同类，server 与
 *    adapters 均可直接 import；client 半不消费故不进 combo 白名单）。
 * ③ 安全语义不变：白名单外一律 415，路径穿越/越界判定仍由各端点自己负责
 *    （本表不承担路径安全职责）。
 */

/** 扩展名（含前导点，小写）→ Content-Type。仅列服务端实际允许出图的类型。 */
export const IMAGE_MIME: Readonly<Record<string, string>> = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
})

/** 判给定扩展名是否为允许出图的白名单类型（端点 415 判据的唯一来源）。 */
export function imageMime(ext: string): string | undefined {
  return IMAGE_MIME[ext.toLowerCase()]
}
