import { reactive } from 'vue'

export interface IWaterfallItem {
  /** 0 或缺失表示未知：后端探测会失败（外链已挂、格式不识别、存量任务还没补） */
  width?: number
  height?: number
  [key: string]: any
}

/**
 * 宽高未知时的占位比例（高 / 宽）。
 * 取 3:4 竖图——推荐流里最常见的形态，占位与真实值差得最少、重排时跳动最小。
 */
export const DEFAULT_ITEM_RATIO = 4 / 3

const useWaterfall = () => {
  // 瀑布流的一些属性
  const waterfallOption = reactive({
    loading: false,
    bottomDistance: 0,
    onlyImage: false, // 是否只展示图片，这是自定义加的一个属性
    topPreloadScreenCount: 0,
    bottomPreloadScreenCount: 0,
    virtual: true,
    // 必须关掉：开着的话追加下一页时，库会把已排好的前缀整段复用、不再调 calcItemHeight，
    // 那些 item 的 width/height 也就此不再被依赖收集——晚到的真实宽高（图片 onload、
    // 视频元数据）写回去既触发不了重排、就算重排也会读缓存，卡片永远停在占位比例上。
    enableCache: false,
    gap: 4,
    padding: '1px 0', // 必须加点边距，不然初始化图少没有滚动条时，图片出不来
    itemMinWidth: 220,
    minColumnCount: 2,
    maxColumnCount: 6,
  })

  /**
   * 瀑布流元素高度的计算函数。
   * <p>宽高未知时必须回退到占位比例：直接 `height * (itemWidth / width)` 在 width 为 0
   * 时算出 NaN，整列定位会崩。调用方拿到真实宽高后就地写回 item，本函数会被重新求值。
   */
  const calcItemHeight = (item: IWaterfallItem, itemWidth: number) => {
    const w = Number(item?.width)
    const h = Number(item?.height)
    const ratio = w > 0 && h > 0 ? h / w : DEFAULT_ITEM_RATIO
    return itemWidth * ratio
  }

  return {
    waterfallOption,
    calcItemHeight,
  }
}

export default useWaterfall
