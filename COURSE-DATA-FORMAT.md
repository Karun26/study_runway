# Course data file format

Quizzes, assessment weights, rubrics and HD guidance come from a JSON file imported in
**Settings › Course data**. Each import replaces the data for the subjects it contains and
leaves other subjects alone, so files can be made one subject at a time.

Rule: only include what the source materials actually say. Anything not provided is left out
(or listed in `missing`), and the dashboard shows it as missing.

```json
{
  "format": "uni-dashboard-course-data",
  "version": 1,
  "generatedAt": "2026-10-18",
  "subjects": [
    {
      "code": "36106",
      "sources": ["Subject outline Spring 2026", "AT3 brief", "AT3 rubric"],
      "learningOutcomes": [{ "id": "SLO1", "text": "…" }],
      "assessments": [
        {
          "id": "AT3",
          "title": "AT3 – Group Project",
          "weight": 40,
          "canvasAssignmentIds": ["284963", "294453", "291573", "284965"],
          "due": null,
          "description": "…",
          "tasks": ["EDA notebooks for assigned tables", "Baseline model", "…"],
          "rubric": [
            { "criterion": "…", "weight": 20, "hd": "HD descriptor", "d": "…", "c": "…", "p": "…" }
          ],
          "hdTips": ["Specific, actionable advice tied to the rubric"]
        }
      ],
      "modules": [
        {
          "id": "w01",
          "title": "Week 1 – …",
          "topics": ["…"],
          "quiz": {
            "questions": [
              {
                "id": "w01-q1",
                "type": "single",
                "kind": "concept",
                "topic": "Bias–variance trade-off",
                "prompt": "…",
                "options": ["…", "…", "…", "…"],
                "answer": 2,
                "explanation": "Why the answer is right and the others are wrong",
                "revise": "Lecture 1 slides 12–18"
              }
            ],
            "retakeQuestions": []
          }
        }
      ],
      "hdGuidance": ["Subject-level advice"],
      "missing": ["Rubric for AT3 not provided"]
    }
  ]
}
```

## Fields

- `code`: 5-digit subject code (36106, 36100, 36103).
- `canvasAssignmentIds`: the number in a Canvas assignment link
  (`…/assignments/284963`). Links the outline's assessment to the calendar items, so one
  assessment can cover several Canvas submissions. Weight is counted once.
- `weight`: percent of the final mark. All weights in a subject should add to 100 for the
  "marks needed" calculation.
- `tasks`: offered as a one-click checklist on the matching deadline cards.

## Questions

| type       | answer                         | extra                         |
|------------|--------------------------------|-------------------------------|
| `single`   | option index (0-based)         | `options` required            |
| `multiple` | array of option indexes        | `options` required            |
| `numeric`  | number                         | `tolerance` (default 1 %)     |

- `kind`: `concept` or `application`. Results are reported separately for each.
- `topic`: used for weak-topic tracking (below 70 % on the latest attempt).
- `revise`: shown when the question is answered wrongly.
- Retakes: attempt 1 uses `questions`; every later attempt uses `questions` plus
  `retakeQuestions`, so the original questions always come back with new ones added.

## Not in this file

Marks and submissions are entered in the dashboard itself, so they stay on your devices.
