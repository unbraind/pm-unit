# Illustrative quantity policies

These examples define test policies, not measured fleet observations. Their
content SHA-256 is recorded separately from the native tracker anchor revision.

## Parallel durations

Two tools start together and each runs for ten seconds. Elapsed wall time is
ten seconds; summed tool duration is twenty seconds. Both quantities use seconds
and the same example population, but have different semantic kinds. Comparing
or combining them as though they measured the same thing must be refused.

## Cached input tokens

Cached input tokens are a subset of total input tokens for the same request
population. A total-plus-cached sum double-counts that subset and must be refused.
The total used by the test control is illustrative. This policy supplies no
cached-token count, so the cached operand and any ratio that requires its value
remain explicitly unknown. Neither a missing count nor a subset relationship
authorizes an invented measurement.
