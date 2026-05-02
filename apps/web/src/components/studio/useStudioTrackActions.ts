import {
  createTrackUploadTarget,
  generateTrack,
  putDirectUpload,
  readFileAsDataUrl,
  shiftRegisteredTrackSyncs,
  updateTrackSync,
  updateTrackVolume,
  uploadTrack,
} from '../../lib/api'
import { prepareAudioFileForUpload } from '../../lib/audio'
import {
  detectUploadKind,
  formatSeconds,
  isDocumentImageUpload,
} from '../../lib/studio'
import type { Studio, TrackSlot } from '../../types/studio'
import type { RunStudioAction, SetStudioActionState } from './studioActionState'

type UseStudioTrackActionsArgs = {
  globalPlaying: boolean
  playingSlots: Set<number>
  registeredSlotIds: number[]
  runStudioAction: RunStudioAction
  setActionState: SetStudioActionState
  setActiveTrackVolume: (slotId: number, volumePercent: number) => void
  stopPlaybackSession: () => void
  studio: Studio | null
}

export function useStudioTrackActions({
  globalPlaying,
  playingSlots,
  registeredSlotIds,
  runStudioAction,
  setActionState,
  setActiveTrackVolume,
  stopPlaybackSession,
  studio,
}: UseStudioTrackActionsArgs) {
  async function handleUpload(track: TrackSlot, file: File | null) {
    if (!studio || !file) {
      return
    }

    const sourceKind = detectUploadKind(file)
    if (!sourceKind) {
      setActionState({ phase: 'error', message: '지원하지 않는 파일 형식입니다.' })
      return
    }

    const uploadSucceeded = await runStudioAction(
      async () => {
        const preparedUpload =
          sourceKind === 'audio'
            ? await prepareAudioFileForUpload(file)
            : {
                filename: file.name,
                blob: file,
                contentType: file.type || 'application/octet-stream',
                contentBase64: undefined,
              }

        const uploadTarget = await createTrackUploadTarget(studio.studio_id, track.slot_id, {
          source_kind: sourceKind,
          filename: preparedUpload.filename,
          size_bytes: preparedUpload.blob.size,
          content_type: preparedUpload.contentType,
        })

        try {
          await putDirectUpload(uploadTarget, preparedUpload.blob)
        } catch {
          const fallbackContentBase64 =
            preparedUpload.contentBase64 ?? (await readFileAsDataUrl(file))
          return uploadTrack(studio.studio_id, track.slot_id, {
            source_kind: sourceKind,
            filename: preparedUpload.filename,
            content_base64: fallbackContentBase64,
            review_before_register: true,
          })
        }

        return uploadTrack(studio.studio_id, track.slot_id, {
          source_kind: sourceKind,
          filename: preparedUpload.filename,
          asset_path: uploadTarget.asset_path,
          review_before_register: true,
        })
      },
      `${track.name} 파일을 서버에 올리고 추출 대기열에 등록하는 중입니다.`,
      `${track.name} 트랙에 ${file.name} 추출 후보를 준비했습니다.`,
    )

    if (!uploadSucceeded) {
      return
    }

    if (isDocumentImageUpload(file)) {
      setActionState({
        phase: 'success',
        message: `${track.name} 문서 분석 작업을 시작했습니다. 추출 후 후보가 표시됩니다.`,
      })
    } else if (sourceKind === 'audio') {
      setActionState({
        phase: 'success',
        message: `${track.name} 음성 추출 작업을 시작했습니다. 추출 후 후보가 표시됩니다.`,
      })
    }
  }

  async function handleGenerate(track: TrackSlot) {
    if (!studio) {
      return
    }
    if (registeredSlotIds.length === 0) {
      setActionState({ phase: 'error', message: 'AI 생성은 등록된 트랙이 하나 이상 필요합니다.' })
      return
    }

    const otherRegisteredSlotIds = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    const contextSlotIds = otherRegisteredSlotIds.length > 0 ? otherRegisteredSlotIds : registeredSlotIds

    await runStudioAction(
      () => generateTrack(studio.studio_id, track.slot_id, contextSlotIds, false, 3),
      `${track.name} 파트 후보를 생성하는 중입니다.`,
      track.slot_id === 6
        ? '퍼커션 트랙에 BPM 기반 비트 후보 3개를 만들었습니다.'
          : `${track.name} 트랙에 참고 트랙 기반 이벤트 후보 3개를 만들었습니다.`,
    )
  }

  async function handleSync(track: TrackSlot, nextOffset: number) {
    if (!studio) {
      return
    }
    const roundedOffset = Math.round(nextOffset * 1000) / 1000
    await runStudioAction(
      () => updateTrackSync(studio.studio_id, track.slot_id, roundedOffset),
      `${track.name} 싱크를 저장하는 중입니다.`,
      `${track.name} 싱크를 ${formatSeconds(roundedOffset)}로 맞췄습니다.`,
    )
  }

  async function handleShiftAllSync(deltaSeconds: number) {
    if (!studio) {
      return
    }
    if (globalPlaying || playingSlots.size > 0) {
      stopPlaybackSession()
    }
    const roundedDelta = Math.round(deltaSeconds * 1000) / 1000
    await runStudioAction(
      () => shiftRegisteredTrackSyncs(studio.studio_id, roundedDelta),
      `등록된 전체 트랙 싱크를 ${formatSeconds(roundedDelta)} 이동하는 중입니다.`,
      `등록된 전체 트랙 싱크를 ${formatSeconds(roundedDelta)} 이동했습니다.`,
    )
  }

  async function handleVolume(track: TrackSlot, nextVolumePercent: number) {
    if (!studio) {
      return
    }
    const volumePercent = Math.max(0, Math.min(100, Math.round(nextVolumePercent)))
    setActiveTrackVolume(track.slot_id, volumePercent)
    await runStudioAction(
      () => updateTrackVolume(studio.studio_id, track.slot_id, volumePercent),
      `${track.name} 음량을 저장하는 중입니다.`,
      `${track.name} 음량을 ${volumePercent}%로 맞췄습니다.`,
    )
  }

  return {
    handleGenerate,
    handleShiftAllSync,
    handleSync,
    handleUpload,
    handleVolume,
  }
}
