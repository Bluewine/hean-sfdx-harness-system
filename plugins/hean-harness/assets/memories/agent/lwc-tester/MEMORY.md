# LWC Tester Agent Memory Index

- [Wire adapter emission deduplication](feedback_wire_deduplication.md) — cross-file contamination via shared worker wire registry; fix by nesting describes to emit each state once
- [LWC prototype getter spying and NavigationMixin mock](feedback_navigation_mixin_mock.md) — getter spying always fails; GenerateUrl rejection needs a direct mixin-prototype override in a single-test file, not a competing jest.mock('lightning/navigation')
- [Orphan wire subscription leak](feedback_orphan_wire_subscription_leak.md) — createElement() without appendChild permanently leaks a wire subscription into later tests in the same file
- [Virtual module mock __esModule flag](feedback_virtual_module_mock_esmodule_flag.md) — default-export virtual mocks (lightning/modal, c/child) need __esModule:true; registerRefreshHandler is sync; modal-header stub renders no text; manual-DOM innerHTML gets scoping tokens
- [Dead branch patterns](feedback_dead_branch_patterns.md) — JSON.parse array guard and never-populated @track state are provably unreachable; classify and document, never fake-cover or istanbul-ignore
- [Worktree missing node_modules](feedback_worktree_missing_node_modules.md) — symlink from main checkout's node_modules, remove it when done; plain `node_modules` symlink isn't gitignored by a trailing-slash entry
- [Full-repo read-only reporting](feedback_full_repo_readonly_reporting.md) — "entire repository" is valid explicit scope; read-only requests skip fix/verification phases and use the user's requested output format
- [Mock implementation leak past clearAllMocks](feedback_mock_implementation_leak.md) — .mockImplementation() survives jest.clearAllMocks() in afterEach; flag as order-dependence risk only if a later call site doesn't re-mock before use
