# Performance Report
> Generated: 2026-07-27T21:35:09.224Z

## Summary
🔴 **Performance Score: 40/100**

| Metric | Value |
|--------|-------|
| Single add avg | 2.10s |
| Single add P99 | 3.51s |
| Mongo queries/student | 9 |
| 700 students sequential | 853.83s |
| Throughput (seq) | 1 students/s |
| Concurrency=100 throughput | 13 req/s |
| Concurrency=100 errors | 0 |

## Critical Issues
🔴 **Too many Mongo queries per student** — 9 queries/add (target ≤ 5). Caused by sequential Teacher + Group + Subscription queries inside `generateSubscriptionsForStudent`.
🔴 **Subscription generation bottleneck** — `generateSubscriptionsForStudent` takes 1149ms (41% of total). Uses bulkWrite but still fetches Teacher + Group sequentially.
🔴 **Teacher.findById on every student add** — 482ms per call. Called inside `resolveStudentPrice` with no caching.
🔴 **Missing Index (COLLSCAN)** — `Student.find({ teacher_id })` scanned 0 docs with no index.
🔴 **Missing Index (COLLSCAN)** — `Student.find({ teacher_id, group_id })` scanned 0 docs with no index.
🔴 **Missing Index (COLLSCAN)** — `Student.find({ teacher_id, name regex })` scanned 0 docs with no index.
🔴 **High P99 latency at concurrency=100** — 10.58s. Event loop blocking or pool wait queue.

## createStudent Step Timings
| Step | Avg ms | % |
|------|--------|---|
| 1_Validation | 0 | 0% |
| 2_DuplicateCheck | 465 | 17% |
| 3_TeacherQuery | 482 | 17% |
| 4_GroupQuery | 0 | 0% |
| 5_StudentCreate | 452 | 16% |
| 6_GenerateSubscriptions | 1149 | 41% |
| 7_Populate | 263 | 9% |
| 8_Serialization | 1 | 0% |
| TOTAL | 2812 | 100% |

## Sequential Test Results
| Count | Total | Avg | P95 | P99 | Students/s | Mongo/student |
|-------|-------|-----|-----|-----|------------|---------------|
| 100 | 161.24s | 1.61s | 2.78s | 6.42s | 1 | 6 |
| 300 | 451.99s | 1.51s | 2.36s | 6.53s | 1 | 6 |
| 700 | 853.83s | 1.22s | 1.37s | 3.69s | 1 | 6 |
| 1000 | 1243.15s | 1.24s | 1.71s | 3.43s | 1 | 6 |

## Concurrent Test Results (700 students each)
| Concurrency | Avg | P95 | P99 | Throughput | Errors | Timeouts |
|-------------|-----|-----|-----|------------|--------|----------|
| 1 | 1.20s | 1.48s | 2.93s | 1 req/s | 0 | 0 |
| 5 | 1.38s | 2.28s | 5.16s | 4 req/s | 0 | 0 |
| 10 | 1.25s | 1.69s | 4.82s | 8 req/s | 0 | 0 |
| 20 | 1.59s | 2.18s | 4.93s | 12 req/s | 0 | 0 |
| 50 | 3.76s | 7.32s | 7.59s | 13 req/s | 0 | 0 |
| 100 | 7.41s | 10.22s | 10.58s | 13 req/s | 0 | 0 |

## Worst Case Scenarios
| Scenario | Total | Avg | P95 | Throughput | Errors |
|----------|-------|-----|-----|------------|--------|
| 100 teachers × 20 students (2000 concurrent adds) | 153.99s | 7.67s | 9.56s | 13 req/s | 0 |
| 1 teacher bulk-imports 700 students (Excel) | 841.72s | 1.20s | 1.30s | 1 req/s | 0 |
| 50 teachers export invoices simultaneously | 4.30s | 2.49s | 4.28s | 12 req/s | 0 |
| 30 teachers open students page (pagination) | 461ms | 310ms | 460ms | 65 req/s | 0 |
| 20 teachers search students simultaneously | 242ms | 230ms | 241ms | 83 req/s | 0 |
| 20 teachers delete students simultaneously | 469ms | 462ms | 469ms | 43 req/s | 0 |

## Database Analysis
| Operation | Stage | Time | Docs Examined | Index |
|-----------|-------|------|---------------|-------|
| Student.find({ teacher_id }) | COLLSCAN ⚠️ | 0ms | 0 | none |
| Student.findOne({ teacher_id, name }) | UNKNOWN | 0ms | 0 | none |
| Student.find({ teacher_id, group_id }) | COLLSCAN ⚠️ | 0ms | 0 | none |
| MonthlySubscription.find({ teacher_id, month, year }) | UNKNOWN | 5ms | 10 | teacher_id_1_month_1_year_1 |
| MonthlySubscription.find({ student_id }) | UNKNOWN | 0ms | 0 | student_id_1 |
| Student.find({ teacher_id, name regex }) | COLLSCAN ⚠️ | 0ms | 0 | none |

## Indexes

### students
| Name | Keys |
|------|------|
| _id_ | `{"_id":1}` |

### monthlysubscriptions
| Name | Keys |
|------|------|
| _id_ | `{"_id":1}` |
| student_id_1 | `{"student_id":1}` |
| teacher_id_1 | `{"teacher_id":1}` |
| student_id_1_month_1_year_1 | `{"student_id":1,"month":1,"year":1}` |
| teacher_id_1_month_1_year_1 | `{"teacher_id":1,"month":1,"year":1}` |
| teacher_id_1_student_id_1 | `{"teacher_id":1,"student_id":1}` |
| teacher_id_1_status_1 | `{"teacher_id":1,"status":1}` |

### teachers
| Name | Keys |
|------|------|
| _id_ | `{"_id":1}` |
| email_1 | `{"email":1}` |
| slug_1 | `{"slug":1}` |
| subscription.status_1 | `{"subscription.status":1}` |
| is_active_1 | `{"is_active":1}` |
| deleted_at_1 | `{"deleted_at":1}` |

### groups
| Name | Keys |
|------|------|
| _id_ | `{"_id":1}` |
| teacher_id_1 | `{"teacher_id":1}` |
| code_1 | `{"code":1}` |

## Memory Peak
| Metric | Value |
|--------|-------|
| RSS | 112 MB |
| Heap Used | 62 MB |
| Heap Total | 93 MB |
| External | 30 MB |

## CPU & Event Loop
| Metric | Value |
|--------|-------|
| Event Loop Avg Lag | 9ms |
| Event Loop Max Lag | 172ms |

## Improvement Suggestions

### Cache Teacher document per request
- **Current**: 482ms per student add
- **Expected after fix**: ~1ms (in-memory)
- **Improvement**: 95%
- **Difficulty**: Easy
- Pass `teacher` object into `generateSubscriptionsForStudent` instead of re-fetching by ID every time.

### Batch subscription inserts with insertMany
- **Current**: 1149ms per student
- **Expected after fix**: ~10ms for 700 students total
- **Improvement**: 80%
- **Difficulty**: Medium
- Collect all subscription docs first, then call `MonthlySubscription.insertMany` once instead of bulkWrite per student.

### Add compound index { teacher_id, name } on students
- **Current**: COLLSCAN on name search
- **Expected after fix**: IXSCAN < 1ms
- **Improvement**: 90%
- **Difficulty**: Easy
- `StudentSchema.index({ teacher_id: 1, name: 1 })`

### Increase MongoDB connection pool size
- **Current**: maxPoolSize: 20
- **Expected after fix**: maxPoolSize: 50
- **Improvement**: 30% at concurrency=100
- **Difficulty**: Easy
- Change `maxPoolSize` in `db.ts` to 50 and add `waitQueueTimeoutMS: 5000`.

### Use bulk endpoint for Excel imports
- **Current**: 853.83s for 700 students
- **Expected after fix**: ~3s
- **Improvement**: 70%
- **Difficulty**: Medium
- Use `Student.insertMany` + single `MonthlySubscription.insertMany` instead of per-student creates.

## Projections After Optimizations

### Single Student Add
| | Current | After Fix |
|-|---------|-----------|
| Avg | 2.10s | ~630ms |
| Mongo queries | 9 | ~3 |

### Bulk Add
| Count | Current | After Fix |
|-------|---------|-----------|
| 100 | 161.24s | ~40.31s |
| 300 | 451.99s | ~113.00s |
| 700 | 853.83s | ~213.46s |
| 1000 | 1243.15s | ~310.79s |

### Concurrent Teachers
| Teachers | Estimated Throughput |
|----------|----------------------|
| 100 | 13 req/s (current) → ~39 req/s |
| 300 | ~26 req/s |
| 500 | ~20 req/s |
