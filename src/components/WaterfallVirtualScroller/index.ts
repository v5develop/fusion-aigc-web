import { reactive, useTemplateRef } from 'vue'

type ItemOption = any

const useWaterfall = () => {
  const vw = useTemplateRef<any>('vw')

  const backTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'instant',
    })
  }

  // 滚动到指定元素的位置
  /*const scrollTo = (id: number) => {
    vw.value?.withItemSpaces((spaces) => {
      for (const space of spaces) {
        // 找到你想滚动到的元素
        if (space.item.id === id) {
          const top = space.top
          // 执行滚动
          window.scrollTo({
            top: top,
            behavior: 'smooth',
          })
          return
        }
      }
    })
  }*/

  // 瀑布流的一些属性
  const waterfallOption = reactive({
    loading: false,
    bottomDistance: 0,
    onlyImage: false, // 是否只展示图片，这是自定义加的一个属性
    topPreloadScreenCount: 0,
    bottomPreloadScreenCount: 0,
    virtual: true,
    enableCache: true,
    gap: 4,
    // padding: '24px 0',
    padding: 0,
    itemMinWidth: 220,
    minColumnCount: 2,
    maxColumnCount: 6,
  })


  // 瀑布流元素高度的计算函数
  const calcItemHeight = (item: ItemOption, itemWidth: number) => {
    return item.height * (itemWidth / item.width)
  }

  // 需要展示数据的属性
  const data = reactive({
    page: 0,
    size: 30,
    total: 0,
    max: 0,
    list: [] as ItemOption[],
    end: false,
  })
  return {
    vw,
    backTop,
    waterfallOption,
    data,
    calcItemHeight,
  }
}

export default useWaterfall
