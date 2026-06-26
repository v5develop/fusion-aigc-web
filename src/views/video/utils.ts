import { entryCodeVal2Label, modelVal2Label, ratioVal2Label, durationVal2Label } from './constants.ts'

export const getMetaData = (params: any) => {
  const _params = params.params;

  return `
    ${entryCodeVal2Label[params.entryCode]} |
    ${modelVal2Label[params.modelCode]} |
    ${ratioVal2Label[_params.aspectRatio]} |
    ${_params.resolution} |
    ${durationVal2Label[_params.duration]}
  `
}
