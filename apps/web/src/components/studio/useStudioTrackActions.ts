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
  formatTrackName,
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
  function stopPlaybackBeforeEditing() {
    if (!globalPlaying && playingSlots.size === 0) {
      return
    }
    stopPlaybackSession()
    setActionState({
      phase: 'success',
      message: '편집을 위해 재생을 정지했습니다.',
    })
  }

  function trackIsBusy(track: TrackSlot): boolean {
    if (track.status !== 'extracting') {
      return false
    }
    setActionState({
      phase: 'error',
      message: `${formatTrackName(track.name)} 트랙은 추출 작업이 진행 중입니다. 작업이 끝난 뒤 다시 시도해 주세요.`,
    })
    return true
  }

  async function handleUpload(track: TrackSlot, file: File | null) {
    if (!studio || !file || trackIsBusy(track)) {
      return
    }
    stopPlaybackBeforeEditing()

    const sourceKind = detectUploadKind(file)
    const trackLabel = formatTrackName(track.name)
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
      `${trackLabel} 파일을 업로드하고 추출 대기열에 등록하는 중입니다.`,
      `${trackLabel} 트랙에 ${file.name} 추출 후보를 준비했습니다.`,
      [
        `${trackLabel} 파일을 서버에 올리는 중입니다.`,
        `${trackLabel} 추출 작업을 대기열에 배치하는 중입니다.`,
        '작업이 끝나면 후보 검토 목록에 표시됩니다.',
      ],
    )

    if (!uploadSucceeded) {
      return
    }

    if (isDocumentImageUpload(file)) {
      setActionState({
        phase: 'success',
        message: `${trackLabel} 문서 분석 작업을 시작했습니다. 후보가 준비되면 검토 목록에 표시됩니다.`,
      })
    } else if (sourceKind === 'audio') {
      setActionState({
        phase: 'success',
        message: `${trackLabel} 오디오 추출 작업을 시작했습니다. 후보가 준비되면 검토 목록에 표시됩니다.`,
      })
    }
  }

  async function handleGenerate(track: TrackSlot) {
    if (!studio || trackIsBusy(track)) {
      return
    }
    stopPlaybackBeforeEditing()
    if (registeredSlotIds.length === 0) {
      setActionState({ phase: 'error', message: 'AI 생성에는 등록된 기준 트랙이 하나 이상 필요합니다.' })
      return
    }

    const otherRegisteredSlotIds = registeredSlotIds.filter((slotId) => slotId !== track.slot_id)
    const contextSlotIds = otherRegisteredSlotIds.length > 0 ? otherRegisteredSlotIds : registeredSlotIds
    const trackLabel = formatTrackName(track.name)

    await runStudioAction(
      () => generateTrack(studio.studio_id, track.slot_id, contextSlotIds, false, 3),
      `${trackLabel} 파트 후보를 생성하는 중입니다.`,
      track.slot_id === 6
        ? '퍼커션 트랙에 BPM 기반 비트 후보 3개를 만들었습니다.'
        : `${trackLabel} 트랙에 참고 트랙 기반 음표 후보 3개를 만들었습니다.`,
      [
        'DeepSeek가 참고 트랙의 화성 방향을 훑는 중입니다.',
        `${trackLabel} 음역과 성부 진행 규칙을 맞추는 중입니다.`,
        '후보 구간을 검토 가능한 블록으로 정리하는 중입니다.',
      ],
    )
  }

  async function handleSync(track: TrackSlot, nextOffset: number) {
    if (!studio || trackIsBusy(track)) {
      return
    }
    stopPlaybackBeforeEditing()
    const roundedOffset = Math.round(nextOffset * 1000) / 1000
    const trackLabel = formatTrackName(track.name)
    await runStudioAction(
      () => updateTrackSync(studio.studio_id, track.slot_id, roundedOffset),
      `${trackLabel} 싱크를 저장하는 중입니다.`,
      `${trackLabel} 싱크를 ${formatSeconds(roundedOffset)}로 맞췄습니다.`,
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
    const trackLabel = formatTrackName(track.name)
    setActiveTrackVolume(track.slot_id, volumePercent)
    await runStudioAction(
      () => updateTrackVolume(studio.studio_id, track.slot_id, volumePercent),
      `${trackLabel} 음량을 저장하는 중입니다.`,
      `${trackLabel} 음량을 ${volumePercent}%로 맞췄습니다.`,
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
