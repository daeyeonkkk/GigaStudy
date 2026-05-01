import { useState } from 'react'

import {
  approveCandidate,
  approveJobCandidates,
  rejectCandidate,
  retryExtractionJob,
} from '../../lib/api'
import type { ExtractionCandidate, Studio, TrackSlot } from '../../types/studio'
import type { RunStudioAction } from './studioActionState'

type CandidateReviewStateProps = {
  pendingCandidates: ExtractionCandidate[]
  runStudioAction: RunStudioAction
  setActionError: (message: string) => void
  studio: Studio | null
}

export function useCandidateReviewState({
  pendingCandidates,
  runStudioAction,
  setActionError,
  studio,
}: CandidateReviewStateProps) {
  const [candidateTargetSlots, setCandidateTargetSlots] = useState<Record<string, number>>({})
  const [candidateOverwriteApprovals, setCandidateOverwriteApprovals] = useState<Record<string, boolean>>({})
  const [jobOverwriteApprovals, setJobOverwriteApprovals] = useState<Record<string, boolean>>({})

  function getSelectedCandidateSlotId(candidate: ExtractionCandidate): number {
    return candidateTargetSlots[candidate.candidate_id] ?? candidate.suggested_slot_id
  }

  function getSelectedCandidateTrack(candidate: ExtractionCandidate): TrackSlot | null {
    if (!studio) {
      return null
    }
    return (
      studio.tracks.find((track) => track.slot_id === getSelectedCandidateSlotId(candidate)) ?? null
    )
  }

  function candidateWouldOverwrite(candidate: ExtractionCandidate): boolean {
    const targetTrack = getSelectedCandidateTrack(candidate)
    if (!targetTrack) {
      return false
    }
    return targetTrack.status === 'registered' || targetTrack.notes.length > 0
  }

  function getPendingJobCandidates(jobId: string): ExtractionCandidate[] {
    return pendingCandidates.filter((candidate) => candidate.job_id === jobId)
  }

  function jobWouldOverwrite(jobId: string): boolean {
    return getPendingJobCandidates(jobId).some((candidate) => {
      const targetTrack = studio?.tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
      return targetTrack ? targetTrack.status === 'registered' || targetTrack.notes.length > 0 : false
    })
  }

  function updateCandidateTargetSlot(candidate: ExtractionCandidate, targetSlotId: number) {
    setCandidateTargetSlots((current) => ({
      ...current,
      [candidate.candidate_id]: targetSlotId,
    }))
    setCandidateOverwriteApprovals((current) => ({
      ...current,
      [candidate.candidate_id]: false,
    }))
  }

  function updateCandidateOverwriteApproval(candidate: ExtractionCandidate, allowOverwrite: boolean) {
    setCandidateOverwriteApprovals((current) => ({
      ...current,
      [candidate.candidate_id]: allowOverwrite,
    }))
  }

  function updateJobOverwriteApproval(jobId: string, allowOverwrite: boolean) {
    setJobOverwriteApprovals((current) => ({
      ...current,
      [jobId]: allowOverwrite,
    }))
  }

  async function handleApproveCandidate(candidate: ExtractionCandidate) {
    if (!studio) {
      return
    }
    const targetSlotId = getSelectedCandidateSlotId(candidate)
    const targetTrack = getSelectedCandidateTrack(candidate)
    const allowOverwrite = candidateOverwriteApprovals[candidate.candidate_id] === true
    if (candidateWouldOverwrite(candidate) && !allowOverwrite) {
      setActionError(`${targetTrack?.name ?? '선택한 트랙'}에 이미 등록된 내용이 있습니다. 덮어쓰기 확인을 체크하세요.`)
      return
    }
    await runStudioAction(
      () => approveCandidate(studio.studio_id, candidate.candidate_id, targetSlotId, allowOverwrite),
      `${targetTrack?.name ?? 'Track'} 후보를 등록하는 중입니다.`,
      `${targetTrack?.name ?? 'Track'} 트랙에 선택한 후보를 등록했습니다.`,
    )
  }

  async function handleRejectCandidate(candidate: ExtractionCandidate) {
    if (!studio) {
      return
    }
    const targetTrack = studio.tracks.find((track) => track.slot_id === candidate.suggested_slot_id)
    await runStudioAction(
      () => rejectCandidate(studio.studio_id, candidate.candidate_id),
      `${targetTrack?.name ?? 'Track'} 후보를 거절하는 중입니다.`,
      `${targetTrack?.name ?? 'Track'} 후보를 거절했습니다.`,
    )
  }

  async function handleApproveJobCandidates(jobId: string) {
    if (!studio) {
      return
    }
    const allowOverwrite = jobOverwriteApprovals[jobId] === true
    if (jobWouldOverwrite(jobId) && !allowOverwrite) {
      setActionError('문서 분석 결과가 기존 등록 트랙에 덮어씁니다. 덮어쓰기 확인을 체크하세요.')
      return
    }
    await runStudioAction(
      () => approveJobCandidates(studio.studio_id, jobId, allowOverwrite),
      '문서 분석 결과를 각 트랙에 등록하는 중입니다.',
      '문서 분석 결과를 제안된 트랙에 등록했습니다.',
    )
  }

  async function handleRetryJob(jobId: string) {
    if (!studio) {
      return
    }
    await runStudioAction(
      () => retryExtractionJob(studio.studio_id, jobId),
      '추출 작업을 다시 대기열에 올리는 중입니다.',
      '추출 작업을 다시 시작했습니다. 완료되면 후보가 표시됩니다.',
    )
  }

  return {
    candidateOverwriteApprovals,
    candidateTargetSlots,
    candidateWouldOverwrite,
    getPendingJobCandidates,
    getSelectedCandidateSlotId,
    handleApproveCandidate,
    handleApproveJobCandidates,
    handleRejectCandidate,
    handleRetryJob,
    jobOverwriteApprovals,
    jobWouldOverwrite,
    updateCandidateOverwriteApproval,
    updateCandidateTargetSlot,
    updateJobOverwriteApproval,
  }
}
