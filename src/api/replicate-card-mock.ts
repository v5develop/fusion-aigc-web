/**
 * 复刻智能体对话的本地假数据（`?mock=replicate` 且当前技能是视频复刻技能时，agentStream 走这里；动态 import，不进主包）。
 *
 * <p>帧形状按 CONTRACT §C / §D 造：analysis / plan / job 卡片帧（同 entity 重复发 = 原位更新）、budget_confirm 中断带
 * replicate_consent。数据复用 replicate-mock（任务按时间推进，`localStorage['fusion:mock-replicate-fail']=3` 可让第 3 段失败），
 * 所以卡片里的 GET job 轮询也是真的会动。流程：随便发一句 → 分析卡 → 方案卡 → 同意卡；点「先做第 1 段」→ 任务卡；
 * 发「继续做剩下的」/「重做第 3 段」→ 再出一张同意卡。
 */
import type { IAgentFrame, IAgentStreamReq } from './agent.ts'
import { replicateMock } from './replicate-mock.ts'
import type { ReplicateJob, ReplicatePlan } from './replicate.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const frame = (eventType: string, payload: Record<string, unknown>): IAgentFrame => ({
  event: 'PROCESSING',
  data: { content: { eventType, payload } },
})

/** 卡片帧：Java 会按 AgentJson.scrub 去掉签名地址，这里同样剔除 videoUrl / coverUrl */
function scrub<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, x) => (k === 'videoUrl' || k === 'coverUrl' ? undefined : x))) as T
}
export function cardFrame(toolName: string, type: 'analysis' | 'plan' | 'job' | 'preview' | 'batch' | 'copy' | 'export', id: string | number, view: unknown): IAgentFrame {
  return frame('tool_result', {
    toolName,
    status: 'completed',
    message: '',
    result: { toolName: toolName, resultType: 'replicate_card', isError: false, entity: { type, id: String(id) }, view: scrub(view) },
  })
}
export function errorCardFrame(toolName: string, message: string, retryable = true): IAgentFrame {
  return frame('tool_result', {
    toolName,
    status: 'failed',
    message,
    result: { resultType: 'replicate_card', isError: true, result: { errorCode: 'REPLICATE_FAILED', message, retryable } },
  })
}
export function consentFrame(consent: Record<string, unknown>): IAgentFrame {
  return frame('interrupt_required', {
    interruptId: `mock-int-${Date.now()}`,
    title: '确认本次点数',
    message: '确认后开始生成，成功才扣点。',
    questions: [
      {
        questionId: 'budget_confirm',
        title: '确认本次点数',
        message: '',
        questionType: 'single_select',
        required: true,
        allowTextInput: false,
        options: [
          { id: 'continue', label: '继续', description: '' },
          { id: 'cancel', label: '不用了', description: '' },
        ],
        replicateConsent: consent,
      },
    ],
  })
}

/** 分析成功后的一键方案（J1）：mock 里补上，真实数据由 Go 出 */
const SUGGESTIONS = [
  { key: 'swap_model', label: '把人物换成我的模特', desc: '画面里有人物，需要你给一张模特图', needs: 'person_image' },
  { key: 'swap_product', label: '把商品换成我的商品', desc: '画面里有主推商品，需要你给一张商品图', needs: 'product_image' },
  { key: 'clean_text', label: '去掉画面上的字幕和水印', desc: '文字由系统重新叠加', needs: '' },
]
/** 定妆图帧（J2）：imageUrl 是否带上由 withUrl 决定（真实链路里签名地址会被清洗，缺失时卡片给占位） */
function previewFrame(planNo: string, withUrl: boolean): IAgentFrame {
  const view = {
    planNo,
    ...(withUrl ? { imageUrl: 'https://picsum.photos/seed/xq-preview/720/1280' } : {}),
    imageRid: 'mock-rid-1',
    frameAtSec: 0.4,
    quotaUsed: 1,
    quotaTotal: 3,
  }
  return cardFrame('定妆图', 'preview', planNo, view)
}

const TEXTS = {
  eta: '约 3–5 分钟',
  refund: '失败的段自动退点，退多少按段算',
  ai: '成片带「AI 生成」标识，不可关闭',
  watermark: '免费用户成片带水印',
  redo: '不满意可单段重做，重做照常收费；视频损坏（黑屏 / 定格 / 文件损坏）按失败处理，该段不扣点',
}
/** 契约原文是 snake_case；question 级键用 lowerCamel（Java 出网转换后的样子），两种都能解析 */
function consentOf(over: { action: string; points: number } & Record<string, unknown>): Record<string, unknown> {
  return {
    rest_points: 0,
    eta_text: TEXTS.eta,
    refund_text: TEXTS.refund,
    ai_mark_text: TEXTS.ai,
    watermark_text: TEXTS.watermark,
    redo_text: TEXTS.redo,
    needs_portrait_consent: false,
    plan_no: '',
    job_id: 0,
    seg_index: 0,
    ...over,
  }
}

let lastPlan: ReplicatePlan | null = null
let lastJob: ReplicateJob | null = null
let mockBatch = false

export async function mockReplicateAgentStream(
  req: IAgentStreamReq,
  opts: { requestId: string; signal: AbortSignal; onFrame: (frame: IAgentFrame) => void },
): Promise<void> {
  const emit = (f: IAgentFrame) => {
    if (!opts.signal.aborted) opts.onFrame(f)
  }
  const step = async (ms: number) => {
    await wait(ms)
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')
  }
  const say = async (text: string) => {
    for (let i = 0; i < text.length; i += 6) {
      await step(30)
      emit(frame('message_delta', { delta: text.slice(i, i + 6), source: 'response' }))
    }
  }
  emit({ event: 'START', data: { content: {} } })
  await step(200)

  const choice = req.attribute?.answers?.budget_confirm?.selected?.[0]
  const content = req.content

  if (choice === 'cancel') {
    await say('好的，先不做，没有扣点。想换个改法随时告诉我。')
  } else if (choice === 'continue' && mockBatch && lastPlan) {
    mockBatch = false
    const made: ReplicateJob[] = []
    for (let i = 0; i < 3; i++) made.push((await replicateMock.confirm(lastPlan.planNo, { planHash: lastPlan.planHash, stage: 'all', expectedPoints: 0 })).data)
    const jobsView = made.map((j) => ({ jobId: j.jobId, status: j.status, statusLabel: j.statusLabel, segDone: j.segDone, segTotal: j.segTotal, money: j.money }))
    emit(cardFrame('批量确认', 'batch', 'mock-batch-1', { batchId: 'mock-batch-1', planNo: lastPlan.planNo, jobs: jobsView, total: made.length, status: 'running' }))
    await say('三条都开始做了，进度见上面的卡片。')
  } else if (choice === 'continue' && lastPlan && !lastJob) {
    // 首次同意：确认方案 → 任务卡
    const res = await replicateMock.confirm(lastPlan.planNo, { planHash: lastPlan.planHash, stage: 'first', expectedPoints: 0 })
    lastJob = res.data
    emit(cardFrame('确认出片', 'job', lastJob.jobId, lastJob))
    await say('已经开始做第 1 段了，做好会在卡片里更新。')
  } else if (choice === 'continue' && lastJob) {
    // 继续 / 重做：只让卡片重新取一次最新任务（mock 里任务按时间自己推进）
    const res = await replicateMock.getJob(String(lastJob.jobId))
    emit(cardFrame('查看任务', 'job', res.data.jobId, res.data))
    await say('收到，已经提交，进度见上面的卡片。')
  } else if (/重做第\s*\d/.test(content) && lastJob) {
    const k = Number(content.match(/重做第\s*(\d)/)?.[1] ?? 3)
    emit(consentFrame(consentOf({ action: 'redo', points: 80, seg_index: k, job_id: lastJob.jobId })))
  } else if (/继续做剩下/.test(content) && lastJob) {
    emit(consentFrame(consentOf({ action: 'continue', points: lastPlan?.stageQuotes.rest ?? 240, job_id: lastJob.jobId })))
  } else if (/发布文案/.test(content) && lastJob) {
    emit(
      cardFrame('生成发布文案', 'copy', `${lastJob.jobId}:douyin`, {
        jobId: lastJob.jobId,
        platform: 'douyin',
        titles: ['一个保温杯，冬天喝水的仪式感', '通勤包里必备，热水喝到下班', '这杯子我用了三个月，说说真实感受'],
        hashtags: ['#保温杯', '#好物分享', '#通勤必备', '#冬日暖饮', '#生活小物'],
        description: '早上灌满热水，到下午还是烫的。杯口好清洗，放包里不漏水，送人自用都合适。',
        coverAtSec: 2.4,
        quotaUsed: 3,
        quotaTotal: 20,
      }),
    )
    await say('文案在上面，点一下就能复制。')
  } else if (/其它比例|其他比例|导出/.test(content) && lastJob) {
    emit(cardFrame('导出比例', 'export', `${lastJob.jobId}:1:1:crop`, { jobId: lastJob.jobId, ratio: '1:1', mode: 'crop', library: '已存入资产库' }))
    emit(cardFrame('导出比例', 'export', `${lastJob.jobId}:9:16:pad`, { jobId: lastJob.jobId, ratio: '9:16', mode: 'pad', library: '已存入资产库' }))
    await say('已经导出，免费，也存进了资产库。')
  } else if (/批量/.test(content) && lastPlan) {
    // 批量：先出批量同意卡；点继续后用真 mock 任务（stage=all）造三条，出批量卡
    mockBatch = true
    emit(
      consentFrame(
        consentOf({
          action: 'batch',
          points: 3 * (lastPlan.stageQuotes.first + lastPlan.stageQuotes.rest),
          rows: ['我的商品：保温杯.jpg', '我的商品：水壶.jpg', '我的商品：运动水杯（蓝色限量款）.jpg'].map((label) => ({
            label,
            points: lastPlan!.stageQuotes.first + lastPlan!.stageQuotes.rest,
          })),
          plan_no: lastPlan.planNo,
        }),
      ),
    )
  } else if (/预览图|定妆/.test(content) && lastPlan) {
    // 一次带地址（被清洗前的样子），一次不带（清洗后的占位）
    emit(previewFrame(lastPlan.planNo, !/无地址/.test(content)))
    await say('预览图在上面，不是成片。')
  } else if (/占位预览|就这样/.test(content)) {
    await say('好的，保留现在的结果，不再扣点。')
  } else {
    // 一轮完整开场：分析卡（原位刷新到完成）→ 方案卡 → 同意卡
    const ana = (await replicateMock.startAnalysis()).data
    emit(cardFrame('分析视频', 'analysis', ana.analysisNo, ana))
    await say('先免费看一遍这条视频。')
    for (let i = 0; i < 12; i++) {
      await step(1000)
      const cur = (await replicateMock.getAnalysis(ana.analysisNo)).data
      const done = cur.status !== 'running' && cur.status !== 'queued'
      emit(cardFrame('分析视频', 'analysis', ana.analysisNo, done && cur.status === 'succeeded' ? { ...cur, suggestions: SUGGESTIONS } : cur))
      if (done) break
    }
    lastJob = null
    lastPlan = (
      await replicateMock.createPlan({
        analysisNo: ana.analysisNo,
        annotations: { dims: { product: { mode: 'replace', refs: [1] } }, audio: 'regenerate' },
        refImages: ['https://example.com/mock-product.jpg'],
        modelGroup: 'vid.seedance-2.5',
      })
    ).data
    emit(cardFrame('生成方案', 'plan', lastPlan.planNo, lastPlan))
    await say('方案在上面。确认没问题，点下面的按钮开始。')
    emit(
      consentFrame(
        consentOf({
          action: 'confirm',
          points: lastPlan.stageQuotes.first,
          rest_points: lastPlan.stageQuotes.rest,
          needs_portrait_consent: true,
          plan_no: lastPlan.planNo,
        }),
      ),
    )
  }
  emit({ event: 'END', data: { content: {} } })
}
