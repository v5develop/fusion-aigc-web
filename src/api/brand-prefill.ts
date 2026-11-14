/**
 * 做同款带入品牌档案用的取数：复用本地生活已有的 Java 接口（GET /brand-profiles 列表、/brand-profiles/{id} 详情，
 * 不新增接口）。`?mock=plaza` 时给两个同形示例档案。
 */
import { brandProfileDetail, loadProfileList, toBrandProfileView, type BrandProfileView, type LLProfileItem } from './local-life-full.ts'
import { isMock } from './mock-switch.ts'

const img = (c: string, t: string) => `https://placehold.co/300x400/${c}/ffffff/png?text=${encodeURIComponent(t)}`

const MOCK_VIEWS: BrandProfileView[] = [
  {
    id: 9001,
    title: '老刘足浴·朝阳店',
    logoUrl: img('875f9a', 'Logo'),
    category: '按摩足疗',
    images: [
      { url: img('34795a', '门头'), role: 'store' },
      { url: img('94651f', '大堂'), role: 'store' },
      { url: img('875f9a', 'Logo'), role: 'logo' },
      { url: img('34795a', '艾灸'), role: 'feature', name: '艾灸' },
    ],
    address: '北京朝阳·三里屯',
    avgPrice: '128',
    meals: [{ name: '双人足疗', price: '198' }],
  },
  {
    id: 9002,
    title: '小周烘焙',
    logoUrl: img('94651f', 'Logo2'),
    category: '美食',
    images: [
      { url: img('94651f', '小周门头'), role: 'store' },
      { url: img('94651f', 'Logo2'), role: 'logo' },
      { url: img('34795a', '吐司'), role: 'feature', name: '吐司' },
    ],
    address: '上海徐汇·武康路',
    avgPrice: '35',
  },
]

export async function brandPrefillList(): Promise<LLProfileItem[]> {
  if (isMock('plaza')) {
    return MOCK_VIEWS.map((v) => ({
      id: v.id,
      title: v.title,
      logoUrl: v.logoUrl,
      source: 'java' as const,
      category: v.category,
      address: v.address,
      coverUrl: v.logoUrl,
    }))
  }
  return loadProfileList('java')
}

export async function brandPrefillView(id: number): Promise<BrandProfileView> {
  if (isMock('plaza')) {
    const v = MOCK_VIEWS.find((x) => x.id === id)
    if (!v) throw new Error('档案不存在')
    return v
  }
  const res = await brandProfileDetail(id)
  if (!res.data) throw new Error('档案不存在')
  return toBrandProfileView(res.data)
}
