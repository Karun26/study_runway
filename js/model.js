// Derived data: assignments, grades, quizzes, weak topics, weekly plan.
import { SUBJECTS } from './ics.js';
import { countdown, dayKey, addDaysKey, dayKeyToDate } from './time.js';

export const GRADE_BANDS = [
  { min: 85, label: 'HD' }, { min: 75, label: 'D' }, { min: 65, label: 'C' }, { min: 50, label: 'P' }, { min: 0, label: 'Z' },
];
export const bandOf = (pct) => GRADE_BANDS.find((b) => pct >= b.min)?.label || 'Z';

export function defaultState(role) {
  return {
    v: 1,
    settings: {
      role, feedUrl: '', autoLockMin: 15,
      targets: Object.fromEntries(SUBJECTS.map((s) => [s.code, 85])),
    },
    calendar: { items: {}, calName: '', lastSuccess: null, lastAttempt: null, lastError: null, source: null, changes: [] },
    user: { asg: {}, marks: {}, weights: {}, modules: {}, quizzes: {} },
    courseData: { subjects: {}, importedAt: null },
    updatedAt: new Date().toISOString(),
  };
}

export const subjectByCode = (code) => SUBJECTS.find((s) => s.code === code);

// ---------- Assignments (from calendar) ----------
export function assignments(state, now = new Date()) {
  return Object.values(state.calendar.items)
    .filter((it) => it.kind === 'assignment' && it.due)
    .map((it) => {
      const u = state.user.asg[it.key] || {};
      const dueDate = new Date(it.due);
      const cd = countdown(dueDate, now);
      return {
        ...it,
        dueDate,
        submitted: !!u.submitted,
        submittedAt: u.submittedAt || null,
        tasks: u.tasks || [],
        level: u.submitted ? 'submitted' : cd.level,
        countdown: cd.text,
        assessment: assessmentForAssignment(state, it),
      };
    })
    .sort((a, b) => a.dueDate - b.dueDate);
}

function cdSubject(state, code) { return state.courseData?.subjects?.[code] || null; }

export function assessmentForAssignment(state, it) {
  const cd = cdSubject(state, it.code);
  if (!cd?.assessments) return null;
  return cd.assessments.find((a) => (a.canvasAssignmentIds || []).map(String).includes(String(it.assignmentId))) || null;
}

/** Weight for an assignment card: from course data, or entered by the user. */
export function weightForAssignment(state, a) {
  if (a.assessment && typeof a.assessment.weight === 'number') {
    const linked = (a.assessment.canvasAssignmentIds || []).length;
    return { value: a.assessment.weight, source: 'outline', shared: linked > 1 };
  }
  const w = state.user.weights[`${a.code}:${a.key}`];
  return typeof w === 'number' ? { value: w, source: 'you' } : null;
}

// ---------- Assessments & grades ----------
/**
 * Assessments for a subject. With course data: the outline's list, each linked
 * to its Canvas assignments. Without: every Canvas assignment stands alone.
 */
export function subjectAssessments(state, code, now = new Date()) {
  const cd = cdSubject(state, code);
  const asgs = assignments(state, now).filter((a) => a.code === code);
  const list = [];
  const linkedKeys = new Set();
  if (cd?.assessments?.length) {
    for (const a of cd.assessments) {
      const ids = (a.canvasAssignmentIds || []).map(String);
      const linked = asgs.filter((x) => ids.includes(String(x.assignmentId)));
      linked.forEach((x) => linkedKeys.add(x.key));
      const id = `cd:${a.id}`;
      const due = linked.length ? linked.reduce((m, x) => (x.dueDate > m ? x.dueDate : m), linked[0].dueDate)
        : (a.due ? new Date(a.due) : null);
      list.push({
        id, title: a.title, weight: typeof a.weight === 'number' ? a.weight : (state.user.weights[`${code}:${id}`] ?? null),
        weightSource: typeof a.weight === 'number' ? 'outline' : (state.user.weights[`${code}:${id}`] != null ? 'you' : null),
        linked, due, rubric: a.rubric || [], hdTips: a.hdTips || [], tasks: a.tasks || [], description: a.description || '',
        mark: state.user.marks[`${code}:${id}`] || null,
        submitted: linked.length ? linked.every((x) => x.submitted) : !!state.user.marks[`${code}:${id}`],
        fromOutline: true,
      });
    }
  }
  for (const x of asgs) {
    if (linkedKeys.has(x.key)) continue;
    const id = x.key;
    const w = state.user.weights[`${code}:${id}`];
    list.push({
      id, title: x.title, weight: typeof w === 'number' ? w : null, weightSource: typeof w === 'number' ? 'you' : null,
      linked: [x], due: x.dueDate, rubric: [], hdTips: [], tasks: [], description: '',
      mark: state.user.marks[`${code}:${id}`] || null, submitted: x.submitted, fromOutline: false,
    });
  }
  return list.sort((a, b) => (a.due || Infinity) - (b.due || Infinity));
}

export function gradeSummary(state, code, now = new Date()) {
  const list = subjectAssessments(state, code, now);
  const target = state.settings.targets?.[code] ?? 85;
  let earned = 0, doneWeight = 0, remainingWeight = 0, totalWeight = 0, missingWeights = 0;
  for (const a of list) {
    if (typeof a.weight !== 'number') { missingWeights++; continue; }
    totalWeight += a.weight;
    if (a.mark && a.mark.outOf > 0) {
      earned += (a.weight * a.mark.score) / a.mark.outOf;
      doneWeight += a.weight;
    } else {
      remainingWeight += a.weight;
    }
  }
  const current = doneWeight > 0 ? (earned / doneWeight) * 100 : null;
  let needed = null, status = 'unknown';
  const weightsComplete = missingWeights === 0 && Math.abs(totalWeight - 100) < 0.5;
  if (weightsComplete) {
    if (earned >= target) status = 'secured';
    else if (remainingWeight <= 0) status = 'final';
    else {
      needed = ((target - earned) / remainingWeight) * 100;
      status = needed > 100 ? 'out-of-reach' : 'possible';
    }
  }
  return {
    target, earned, doneWeight, remainingWeight, totalWeight, current, needed, status,
    missingWeights, weightsComplete, maxPossible: weightsComplete ? earned + remainingWeight : null,
  };
}

// ---------- Modules & quizzes ----------
export function modulesOf(state, code) {
  return cdSubject(state, code)?.modules || [];
}

export function moduleKey(code, modId) { return `${code}:${modId}`; }

export function quizQuestionsFor(mod, attemptNumber) {
  const core = mod.quiz?.questions || [];
  const extra = mod.quiz?.retakeQuestions || [];
  return attemptNumber <= 1 ? core : [...core, ...extra];
}

export function isCorrect(q, ans) {
  if (ans == null || ans === '') return false;
  if (q.type === 'multiple') {
    const want = [...(q.answer || [])].map(Number).sort();
    const got = [...ans].map(Number).sort();
    return want.length === got.length && want.every((v, i) => v === got[i]);
  }
  if (q.type === 'numeric') {
    const v = parseFloat(String(ans).replace(/,/g, ''));
    if (Number.isNaN(v)) return false;
    const tol = typeof q.tolerance === 'number' ? q.tolerance : Math.abs(q.answer) * 0.01;
    return Math.abs(v - q.answer) <= tol + 1e-12;
  }
  return Number(ans) === Number(q.answer);
}

export function gradeQuiz(questions, answers) {
  const results = questions.map((q) => ({ id: q.id, correct: isCorrect(q, answers[q.id]), topic: q.topic || 'General', kind: q.kind || 'concept' }));
  const correct = results.filter((r) => r.correct).length;
  const topics = {};
  for (const r of results) {
    topics[r.topic] ??= { right: 0, total: 0 };
    topics[r.topic].total++;
    if (r.correct) topics[r.topic].right++;
  }
  const kinds = {};
  for (const r of results) {
    kinds[r.kind] ??= { right: 0, total: 0 };
    kinds[r.kind].total++;
    if (r.correct) kinds[r.kind].right++;
  }
  return { results, correct, total: questions.length, pct: questions.length ? (correct / questions.length) * 100 : 0, topics, kinds };
}

export function moduleStatus(state, code, mod) {
  const k = moduleKey(code, mod.id);
  const attempts = state.user.quizzes[k] || [];
  const latest = attempts[attempts.length - 1] || null;
  return {
    done: !!state.user.modules[k]?.done,
    hasQuiz: (mod.quiz?.questions || []).length > 0,
    attempts,
    latestPct: latest ? latest.pct : null,
    bestPct: attempts.length ? Math.max(...attempts.map((a) => a.pct)) : null,
  };
}

export function subjectProgress(state, code) {
  const mods = modulesOf(state, code);
  if (!mods.length) return { total: 0, done: 0, understanding: null, quizzed: 0 };
  let done = 0, sum = 0, quizzed = 0;
  for (const m of mods) {
    const s = moduleStatus(state, code, m);
    if (s.done) done++;
    if (s.latestPct != null) { sum += s.latestPct; quizzed++; }
  }
  return { total: mods.length, done, quizzed, understanding: quizzed ? sum / quizzed : null };
}

/** Weak topics from each module's latest attempt (below 70%). */
export function weakTopics(state, codeFilter = null) {
  const out = [];
  for (const s of SUBJECTS) {
    if (codeFilter && s.code !== codeFilter) continue;
    for (const m of modulesOf(state, s.code)) {
      const attempts = state.user.quizzes[moduleKey(s.code, m.id)] || [];
      const latest = attempts[attempts.length - 1];
      if (!latest) continue;
      for (const [topic, t] of Object.entries(latest.topics || {})) {
        const pct = (t.right / t.total) * 100;
        if (pct < 70) {
          out.push({ code: s.code, moduleId: m.id, moduleTitle: m.title, topic, pct, revise: latest.revise?.[topic] || [] });
        }
      }
    }
  }
  return out.sort((a, b) => a.pct - b.pct);
}

// ---------- Calendar helpers ----------
export function sessionsOnDay(state, key) {
  return Object.values(state.calendar.items)
    .filter((it) => it.kind !== 'assignment' && dayKey(new Date(it.start)) === key)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export function dueOnDay(list, key) {
  return list.filter((a) => dayKey(a.dueDate) === key);
}

// ---------- Weekly plan ----------
/**
 * Seven-day plan. Each day lists sessions, deadlines and up to two focus
 * blocks. Priority of a pending assignment on a given day =
 * weight (or 10 if unknown) ÷ days remaining until it is due.
 */
export function weeklyPlan(state, now = new Date()) {
  const list = assignments(state, now);
  const pending = list.filter((a) => !a.submitted && a.dueDate > now);
  const overdue = list.filter((a) => !a.submitted && a.dueDate <= now);
  const weak = weakTopics(state);
  const today = dayKey(now);
  const days = [];
  let weakIdx = 0;
  let yesterday = new Set();
  let unknownWeights = 0;
  for (const a of pending) if (!weightForAssignment(state, a)) unknownWeights++;

  for (let i = 0; i < 7; i++) {
    const key = addDaysKey(today, i);
    const dayStart = i === 0 ? now : dayKeyToDate(key, 8, 0);
    const candidates = pending
      .filter((a) => dayKey(a.dueDate) >= key)
      .map((a) => {
        const w = weightForAssignment(state, a)?.value ?? 10;
        const daysLeft = Math.max(0.5, (a.dueDate - dayStart) / 864e5);
        // Parts of one task (same subject, same due day) count as one piece of work.
        const group = a.assessment?.id ? `${a.code}:${a.assessment.id}` : `${a.code}:${dayKey(a.dueDate)}`;
        // Rotate: something worked on yesterday drops in priority unless it's due tomorrow or sooner.
        const rest = yesterday.has(group) && daysLeft > 1.5 ? 0.55 : 1;
        return { a, group, score: (w / daysLeft) * rest, daysLeft };
      })
      .filter((c) => c.daysLeft <= 21)
      .sort((x, y) => y.score - x.score);

    const focus = [];
    if (i === 0 && overdue.length) {
      focus.push({ type: 'overdue', count: overdue.length });
    }
    // Avoid two parts of the same assessment filling both slots.
    const seen = new Set();
    for (const c of candidates) {
      if (seen.has(c.group)) continue;
      seen.add(c.group);
      focus.push({ type: 'assignment', a: c.a });
      if (focus.filter((f) => f.type === 'assignment').length >= 2) break;
    }
    yesterday = seen;
    if (weak.length && (i % 2 === 1 || focus.length < 2)) {
      focus.push({ type: 'revise', w: weak[weakIdx % weak.length] });
      weakIdx++;
    }
    days.push({
      key,
      sessions: sessionsOnDay(state, key).filter((s) => s.kind !== 'survey'),
      due: dueOnDay(pending, key),
      focus,
    });
  }
  return { days, unknownWeights };
}

// ---------- Missing information ----------
export function missingInfo(state, code) {
  const cd = cdSubject(state, code);
  const out = [];
  if (!cd) {
    out.push('No subject outline imported yet, so assessment weights, rubrics, learning outcomes and quizzes are missing.');
  } else {
    if (!cd.learningOutcomes?.length) out.push('Learning outcomes are missing.');
    const as = cd.assessments || [];
    if (!as.length) out.push('Assessment list is missing.');
    const noWeight = as.filter((a) => typeof a.weight !== 'number');
    if (noWeight.length) out.push(`Weighting missing for ${noWeight.map((a) => a.title).join(', ')}.`);
    const total = as.reduce((s, a) => s + (typeof a.weight === 'number' ? a.weight : 0), 0);
    if (as.length && !noWeight.length && Math.abs(total - 100) > 0.5) out.push(`Assessment weights add up to ${total}%, not 100%.`);
    const noRubric = as.filter((a) => !(a.rubric || []).length);
    if (noRubric.length) out.push(`Marking rubric missing for ${noRubric.map((a) => a.title).join(', ')}.`);
    const mods = cd.modules || [];
    if (!mods.length) out.push('No modules imported, so there are no quizzes yet.');
    const noQuiz = mods.filter((m) => !(m.quiz?.questions || []).length);
    if (mods.length && noQuiz.length) out.push(`No quiz yet for ${noQuiz.length} module${noQuiz.length > 1 ? 's' : ''} (materials not provided).`);
    for (const m of cd.missing || []) out.push(m);
  }
  const unlinked = subjectAssessments(state, code).filter((a) => !a.fromOutline);
  if (cd?.assessments?.length && unlinked.length) {
    out.push(`${unlinked.length} Canvas item${unlinked.length > 1 ? 's are' : ' is'} not linked to an outline assessment: ${unlinked.map((a) => a.title).join(', ')}.`);
  }
  return out;
}

// ---------- Course data import ----------
export function validateCourseData(data) {
  const errors = [];
  const warnings = [];
  if (!data || data.format !== 'uni-dashboard-course-data') {
    errors.push('This file is not a course data file (format should be "uni-dashboard-course-data").');
    return { errors, warnings };
  }
  if (!Array.isArray(data.subjects) || !data.subjects.length) errors.push('No subjects found in the file.');
  for (const s of data.subjects || []) {
    if (!/^\d{5}$/.test(String(s.code || ''))) { errors.push(`A subject has an invalid code: "${s.code}".`); continue; }
    if (!subjectByCode(String(s.code))) warnings.push(`Subject ${s.code} isn't one of your enrolled subjects; it will be stored but not shown.`);
    const ids = new Set();
    for (const a of s.assessments || []) {
      if (!a.id || !a.title) errors.push(`${s.code}: every assessment needs an id and a title.`);
      if (ids.has(a.id)) errors.push(`${s.code}: duplicate assessment id "${a.id}".`);
      ids.add(a.id);
    }
    for (const m of s.modules || []) {
      if (!m.id || !m.title) { errors.push(`${s.code}: every module needs an id and a title.`); continue; }
      const qs = [...(m.quiz?.questions || []), ...(m.quiz?.retakeQuestions || [])];
      const qids = new Set();
      for (const q of qs) {
        const where = `${s.code} ${m.id} ${q.id || '(no id)'}`;
        if (!q.id || qids.has(q.id)) errors.push(`${where}: questions need unique ids.`);
        qids.add(q.id);
        if (!q.prompt) errors.push(`${where}: missing prompt.`);
        if (q.type === 'single') {
          if (!Array.isArray(q.options) || !(q.answer >= 0 && q.answer < q.options.length)) errors.push(`${where}: answer must be an option index.`);
        } else if (q.type === 'multiple') {
          if (!Array.isArray(q.options) || !Array.isArray(q.answer) || q.answer.some((i) => !(i >= 0 && i < q.options.length))) errors.push(`${where}: answer must list option indexes.`);
        } else if (q.type === 'numeric') {
          if (typeof q.answer !== 'number') errors.push(`${where}: numeric answer must be a number.`);
        } else {
          errors.push(`${where}: unknown question type "${q.type}".`);
        }
      }
    }
  }
  return { errors, warnings };
}
