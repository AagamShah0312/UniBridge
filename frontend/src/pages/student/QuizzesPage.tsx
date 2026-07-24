import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, HelpCircle, Play, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { studentApi } from '@/api/student'
import type { StudentQuiz } from '@/types/student'
import { PageShell } from '@/components/shared/PageShell'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'

type Question = { id: string; text: string; options: { id: string; label: string; text: string }[] }
type QuizAttempt = { quizId: string; title: string; attemptNumber: number; questions: Question[] }
type QuizResult = { quizId: string; score: number; correctCount: number; totalQuestions: number; attemptsTaken: number; maxAttempts?: number; results: Array<{ questionId: string; questionText: string; options?: { id: string; label: string; text: string }[]; selectedOption: string; correctOption: string; isCorrect: boolean; explanation?: string }> }

export default function StudentQuizzesPage() {
  const client = useQueryClient()
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [subjectId, setSubjectId] = useState('')
  const [selectedChapters, setSelectedChapters] = useState<string[]>([])
  const [activeAttempt, setActiveAttempt] = useState<QuizAttempt | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [review, setReview] = useState<QuizResult | null>(null)
  const list = useQuery({ queryKey: ['student', 'quizzes'], queryFn: () => studentApi.quizzes({ limit: 50 }) })
  const subjects = useQuery({ queryKey: ['student', 'subjects'], queryFn: studentApi.subjects })
  const chapters = useQuery({ queryKey: ['student', 'quiz-chapters', subjectId], queryFn: () => studentApi.quizChapters(subjectId), enabled: Boolean(subjectId) })
  const refresh = () => client.invalidateQueries({ queryKey: ['student', 'quizzes'] })
  const generate = useMutation({ mutationFn: studentApi.generateAiQuiz, onSuccess: () => { setGeneratorOpen(false); setSelectedChapters([]); refresh() } })
  const start = useMutation({ mutationFn: studentApi.startQuiz, onSuccess: (data) => { setAnswers({}); setActiveAttempt(data) } })
  const submit = useMutation({ mutationFn: ({ id, selected, presentation }: { id: string; selected: Record<string, string>; presentation: unknown }) => studentApi.submitQuiz(id, selected, presentation), onSuccess: (data) => { setActiveAttempt(null); setResult(data); refresh() } })
  const loadReview = useMutation({ mutationFn: studentApi.quizResult, onSuccess: setReview })
  const removeQuiz = useMutation({ mutationFn: studentApi.deleteAiQuiz, onSuccess: refresh })
  const subjectRows = Array.isArray(subjects.data)
    ? subjects.data
    : Array.isArray((subjects.data as { subjects?: unknown } | undefined)?.subjects)
      ? (subjects.data as { subjects: Array<{ id: string; code: string; name: string }> }).subjects
      : []

  const toggleChapter = (chapter: string) => setSelectedChapters((current) => current.includes(chapter) ? current.filter((item) => item !== chapter) : [...current, chapter])
  const openAttempt = (quiz: StudentQuiz) => start.mutate(quiz.id)
  const submitAttempt = () => {
    if (!activeAttempt || activeAttempt.questions.some((question) => !answers[question.id])) return
    submit.mutate({ id: activeAttempt.quizId, selected: answers, presentation: { questionOrder: activeAttempt.questions.map((question) => question.id), optionOrder: Object.fromEntries(activeAttempt.questions.map((question) => [question.id, question.options.map((option) => option.id)])) } })
  }

  return (
    <PageShell title="Quizzes" subtitle={list.data ? `${list.data.total} available` : 'Generate practice quizzes from faculty notes'} action={<Button leftIcon={<Sparkles size={15} />} onClick={() => setGeneratorOpen(true)}>Generate with AI</Button>}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {list.isLoading ? <CardSkeleton height={200} /> : list.data && list.data.data.length === 0 ? (
            <EmptyState icon={<HelpCircle size={22} />} title="No quizzes available" description="Generate an AI practice quiz from your faculty notes." />
          ) : <div className="space-y-3">{list.data?.data.map((quiz) => {
            const canRetry = (quiz.attemptsTaken ?? 0) < (quiz.maxAttempts ?? 1) && quiz.status !== 'EXPIRED'
            return <Card key={quiz.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><div className="text-sm font-semibold text-text-primary">{quiz.title}</div>{quiz.isStudentGenerated && <Badge tone="primary">AI practice</Badge>}{quiz.attemptsTaken ? <Badge tone="success">{quiz.attemptsTaken}/{quiz.maxAttempts ?? 1} attempts</Badge> : null}</div><div className="mt-0.5 text-xs text-text-muted">{quiz.subject.code} · {quiz.subject.name}</div>{quiz.description && <p className="mt-1.5 text-xs text-text-secondary">{quiz.description}</p>}<div className="mt-2 flex flex-wrap gap-3 text-[11px] text-text-secondary"><span><b>{quiz.questionCount ?? 0}</b> MCQs</span>{quiz.score != null && <span>Best marks <b>{quiz.score}%</b></span>}{quiz.timeLimitMins && <span>{quiz.timeLimitMins} min</span>}</div></div><div className="flex gap-2">{quiz.isStudentGenerated && <Button variant="ghost" size="sm" leftIcon={<Trash2 size={13} />} loading={removeQuiz.isPending} onClick={() => { if (window.confirm(`Delete ${quiz.title}?`)) removeQuiz.mutate(quiz.id) }}>Delete</Button>}{quiz.attemptsTaken ? <><Button variant="outline" size="sm" onClick={() => loadReview.mutate(quiz.id)}>Review</Button>{canRetry && <Button size="sm" leftIcon={<RefreshCw size={13} />} onClick={() => openAttempt(quiz)} loading={start.isPending}>Retry</Button>}</> : <Button size="sm" leftIcon={<Play size={13} />} onClick={() => openAttempt(quiz)} loading={start.isPending}>Start</Button>}</div></div></Card>
          })}</div>}
        </div>
        <Card><div className="border-b border-border p-4 text-sm font-semibold text-text-primary">Completed Quizzes</div><div className="p-4"><p className="mb-3 text-xs text-text-muted">Name, best marks and attempts taken.</p><div className="space-y-2">{list.data?.data.filter((quiz) => quiz.attemptsTaken).map((quiz) => <button key={quiz.id} className="w-full rounded-sm bg-surface-2 px-3 py-2 text-left text-xs hover:bg-primary-light" onClick={() => loadReview.mutate(quiz.id)}><div className="font-semibold text-text-primary">{quiz.title}</div><div className="mt-0.5 text-text-muted">{quiz.score}% · {quiz.attemptsTaken}/{quiz.maxAttempts ?? 1} attempts</div></button>) || <p className="text-xs text-text-muted">No attempts yet.</p>}</div></div></Card>
      </div>

      <Modal open={generatorOpen} onClose={() => setGeneratorOpen(false)} title="Generate AI practice quiz" subtitle="Questions are created only from processed faculty notes." size="md" footer={<><Button variant="outline" onClick={() => setGeneratorOpen(false)}>Cancel</Button><Button loading={generate.isPending} disabled={!subjectId || !selectedChapters.length} onClick={() => generate.mutate({ subjectId, chapters: selectedChapters })}>Generate MCQs</Button></>}>
        <label className="mb-1 block text-xs font-semibold text-text-secondary">Subject</label><Select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setSelectedChapters([]) }} placeholder="Choose a subject" options={subjectRows.map((subject: { id: string; code: string; name: string }) => ({ value: subject.id, label: `${subject.code} - ${subject.name}` }))} />
        {subjectId && <div className="mt-5"><div className="mb-2 text-xs font-semibold text-text-secondary">Chapters</div>{chapters.isLoading ? <p className="text-xs text-text-muted">Loading processed note chapters...</p> : chapters.data?.chapters.length ? <div className="grid gap-2 sm:grid-cols-2">{chapters.data.chapters.map((chapter) => <label key={chapter} className="flex cursor-pointer items-center gap-2 rounded-sm border border-border p-3 text-xs text-text-primary hover:border-primary"><input type="checkbox" checked={selectedChapters.includes(chapter)} onChange={() => toggleChapter(chapter)} className="h-4 w-4 accent-primary" />{chapter}</label>)}</div> : <p className="rounded-sm bg-surface-2 p-3 text-xs text-text-muted">No processed faculty notes exist for this subject yet.</p>}</div>}
        {generate.error && <p className="mt-3 text-xs text-danger">{generate.error instanceof Error ? generate.error.message : 'Unable to generate the quiz.'}</p>}
      </Modal>

      <Modal open={Boolean(activeAttempt)} onClose={() => !submit.isPending && setActiveAttempt(null)} title={activeAttempt?.title} subtitle={`Attempt ${activeAttempt?.attemptNumber ?? 1} · Choose one answer for every MCQ`} size="lg" footer={<><span className="mr-auto text-xs text-text-muted">{Object.keys(answers).length}/{activeAttempt?.questions.length ?? 0} answered</span><Button variant="outline" onClick={() => setActiveAttempt(null)}>Cancel</Button><Button loading={submit.isPending} disabled={!activeAttempt || activeAttempt.questions.some((question) => !answers[question.id])} onClick={submitAttempt}>Submit quiz</Button></>}>
        <div className="space-y-5">{activeAttempt?.questions.map((question, index) => <div key={question.id} className="rounded-card border border-border p-4"><div className="mb-3 text-sm font-semibold text-text-primary"><span className="mr-2 text-primary">{index + 1}.</span>{question.text}</div><div className="grid gap-2">{question.options.map((option) => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-sm border p-3 text-sm transition-colors ${answers[question.id] === option.id ? 'border-primary bg-primary-light text-primary' : 'border-border text-text-secondary hover:bg-surface-2'}`}><input type="radio" name={question.id} checked={answers[question.id] === option.id} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} className="mt-0.5 accent-primary" /><span><b className="mr-2">{option.label}.</b>{option.text}</span></label>)}</div></div>)}</div>
      </Modal>

      <Modal open={Boolean(result)} onClose={() => setResult(null)} title="Quiz submitted" subtitle={result ? `${result.correctCount}/${result.totalQuestions} correct` : undefined} footer={<><Button variant="outline" onClick={() => setResult(null)}>Close</Button>{result && result.attemptsTaken < (result.maxAttempts ?? 1) && <Button leftIcon={<RefreshCw size={14} />} onClick={() => { const quiz = list.data?.data.find((item) => item.id === result.quizId); setResult(null); if (quiz) openAttempt(quiz) }}>Retry</Button>}</>}><div className="py-6 text-center"><div className="text-5xl font-bold text-primary">{result?.score}%</div><p className="mt-2 text-sm text-text-secondary">Best marks are retained across up to {result?.maxAttempts ?? 1} attempts.</p></div></Modal>
      <Modal open={Boolean(review)} onClose={() => setReview(null)} title="Questions and answers" subtitle={review ? `Best score: ${review.score}%` : undefined} size="lg" footer={<Button onClick={() => setReview(null)}>Close</Button>}><div className="space-y-4">{review?.results.map((item, index) => <div key={item.questionId} className={`rounded-card border p-4 ${item.isCorrect ? 'border-success/30 bg-success/5' : 'border-danger/30 bg-danger/5'}`}><div className="flex gap-2 text-sm font-semibold text-text-primary"><CheckCircle2 size={16} className={item.isCorrect ? 'text-success' : 'text-danger'} />{index + 1}. {item.questionText}</div>{item.options?.map((option) => <div key={option.id} className={`mt-2 rounded-sm px-3 py-2 text-xs ${option.id === item.correctOption ? 'bg-success/15 text-success' : option.id === item.selectedOption ? 'bg-danger/15 text-danger' : 'bg-surface-2 text-text-secondary'}`}><b>{option.label}.</b> {option.text}</div>)}{item.explanation && <p className="mt-2 text-xs text-text-secondary">{item.explanation}</p>}</div>)}</div></Modal>
    </PageShell>
  )
}
