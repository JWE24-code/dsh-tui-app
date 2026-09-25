/**
 * Smoke tests for `/jobs` formatting: running jobs first, settled ones newest
 * first, and a duration that reads like a person wrote it.
 */
import assert from 'node:assert/strict'
import { formatDuration, jobMark, renderJobs, type JobLike } from '../src/tui/jobs.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

const NOW = 1_000_000_000_000
const job = (over: Partial<JobLike>): JobLike => ({
  id: 'job-1',
  kind: 'bash',
  label: 'npm install',
  status: 'running',
  startedAt: NOW - 5_000,
  ...over,
})

// ------------------------------------------------------------- durations

check('seconds read as seconds', formatDuration(5) === '5s')
check('sub-second rounds down to zero', formatDuration(0.4) === '0s')
check('a minute reads as minutes', formatDuration(119) === '1m')
check('an hour reads as hours', formatDuration(7_200) === '2h')
check('a day reads as days', formatDuration(200_000) === '2d')
check('a negative duration never prints below zero', formatDuration(-5) === '0s')

// ----------------------------------------------------------------- marks

check('running jobs spin', jobMark('running') === '⠹')
check('stopping jobs spin differently', jobMark('stopping') === '⠴')
check('completed jobs check', jobMark('completed') === '✓')
check('killed jobs are quiet', jobMark('killed') === '·')
check('failed jobs cross', jobMark('failed') === '✗')
check('an unknown status is not a success mark', jobMark('weird') === '✗')

// ------------------------------------------------------------------ list

check('an empty list says so', renderJobs([], NOW).includes('Nothing has run'))
const one = renderJobs([job({})], NOW)
check('a running job is listed', one.includes('npm install'))
check('the job id is shown', one.includes('`job-1`'))
check('the kind is shown', one.includes('bash'))
check('the status is shown', one.includes('running'))
check('the duration is shown', one.includes('5s'))
const withDetail = renderJobs([job({ status: 'failed', detail: 'exit 2', finishedAt: NOW - 1_000 })], NOW)
check('a terminal detail is shown', withDetail.includes('exit 2'))
check('settled jobs land under Finished', withDetail.includes('Finished (1)'))

const mixed = renderJobs(
  [
    job({ id: 'old', status: 'completed', finishedAt: NOW - 60_000 }),
    job({ id: 'new', status: 'completed', finishedAt: NOW - 1_000 }),
    job({ id: 'live', status: 'running' }),
  ],
  NOW,
)
const order = ['live', 'new', 'old'].map((id) => mixed.indexOf(id)) as [number, number, number]
check('running jobs come before finished ones', order[0] < order[1])
check('finished jobs are newest first', order[1] < order[2])
check('the running section counts', mixed.includes('Running (1)'))
check('the finished section counts', mixed.includes('Finished (2)'))
check('the kill hint is present', mixed.includes('/jobs kill <id>'))

console.log(`ok - ${String(checks)} jobs checks passed`)
