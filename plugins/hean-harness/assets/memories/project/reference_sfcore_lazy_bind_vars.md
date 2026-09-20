---
name: SFCORE lazy bind var creation
description: SFCORE_Query bind vars are created lazily inside toString() — putAll must come after toString() when subclassing
type: reference
originSessionId: 32f00727-3415-4a8e-9f5b-75ad44614350
---
SFCORE creates bind vars lazily: they don't exist in `getBindVars()` until `toString()` is called on the condition.

When subclassing `SFCORE_Query` and propagating an inner condition's bind vars upward (via `putAll`), always call `innerCondition.toString()` first and capture the result, then call `putAll`, then build the return string using the captured value.

**Wrong:**
```apex
this.getBindVars().putAll(this.subcondition.getBindVars()); // empty — bindVars not yet created
return ... + this.subcondition.toString() + ...;            // bindVars created here, too late
```

**Correct:**
```apex
String sub = this.subcondition.toString();                  // creates bindVars in subcondition
this.getBindVars().putAll(this.subcondition.getBindVars()); // now non-empty
return ... + sub + ...;
```

The symptom is `Key 'bindVar1' does not exist in the bindMap` in the Apex debug log, thrown on a subquery whose bind vars were copied before `toString()` ran.