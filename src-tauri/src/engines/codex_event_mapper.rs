use std::collections::{HashMap, HashSet};

use serde_json::Value;
use uuid::Uuid;

use super::{
    ActionResult, ActionType, DiffScope, EngineEvent, OutputStream, TokenUsage,
    TurnCompletionStatus,
};

#[derive(Default)]
pub struct TurnEventMapper {
    engine_action_to_internal: HashMap<String, String>,
    pending_actions_without_engine_id: Vec<String>,
    latest_token_usage: Option<TokenUsage>,
    streamed_agent_message_items: HashSet<String>,
}

pub struct ApprovalRequest {
    pub approval_id: String,
    pub server_method: String,
    pub event: EngineEvent,
}

impl TurnEventMapper {
    pub fn map_notification(&mut self, method: &str, params: &Value) -> Vec<EngineEvent> {
        let normalized = normalize_method(method);

        match normalized.as_str() {
            "turn/started" => vec![EngineEvent::TurnStarted],
            "turn/completed" => {
                let mut events = Vec::new();
                let token_usage =
                    extract_token_usage(params).or_else(|| self.latest_token_usage.clone());
                let status = extract_turn_completion_status(params);

                if status == TurnCompletionStatus::Failed {
                    let message = extract_nested_string(params, &["turn", "error", "message"])
                        .or_else(|| extract_nested_string(params, &["error", "message"]))
                        .unwrap_or_else(|| "Codex turn failed".to_string());

                    events.push(EngineEvent::Error {
                        message,
                        recoverable: false,
                    });
                }

                events.push(EngineEvent::TurnCompleted {
                    token_usage,
                    status,
                });
                self.latest_token_usage = None;
                events
            }
            "turn/diff/updated" => {
                let diff = extract_any_string(params, &["diff"]).unwrap_or_default();
                vec![EngineEvent::DiffUpdated {
                    diff,
                    scope: DiffScope::Turn,
                }]
            }
            "turn/plan/updated" => {
                let content = render_plan_update(params);
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            "item/agentmessage/delta" => {
                if let Some(item_id) = extract_any_string(params, &["itemId", "item_id", "id"]) {
                    self.streamed_agent_message_items.insert(item_id);
                }
                let content =
                    extract_any_string(params, &["delta", "text", "content"]).unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::TextDelta { content }]
                }
            }
            "item/plan/delta" => {
                let content =
                    extract_any_string(params, &["delta", "text", "content"]).unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            "item/reasoning/summarytextdelta" | "item/reasoning/textdelta" => {
                let content =
                    extract_any_string(params, &["delta", "text", "content"]).unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            "thread/tokenusage/updated" => {
                self.latest_token_usage = extract_token_usage(params);
                Vec::new()
            }
            "item/started" => self.map_item_started(params),
            "item/completed" => self.map_item_completed(params),
            "item/commandexecution/outputdelta" | "item/filechange/outputdelta" => {
                self.map_output_delta(params).into_iter().collect()
            }
            "error" => {
                let message = extract_nested_string(params, &["error", "message"])
                    .or_else(|| extract_any_string(params, &["message"]))
                    .unwrap_or_else(|| "Codex reported an error".to_string());
                let recoverable = params
                    .get("willRetry")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                vec![EngineEvent::Error {
                    message,
                    recoverable,
                }]
            }
            _ => Vec::new(),
        }
    }

    pub fn map_turn_result(&mut self, result: &Value) -> Vec<EngineEvent> {
        let mut out = Vec::new();

        if let Some(events) = result.get("events").and_then(Value::as_array) {
            for event in events {
                let method = extract_any_string(event, &["method", "event", "type", "name"])
                    .unwrap_or_else(|| "turn/event".to_string());
                let params = event.get("params").unwrap_or(event);
                out.extend(self.map_notification(&method, params));
            }
        }

        if out.is_empty() {
            if let Some(turn) = result.get("turn") {
                if let Some(status) = turn.get("status").and_then(Value::as_str) {
                    let normalized_status = status.to_lowercase();
                    if normalized_status == "inprogress" {
                        out.push(EngineEvent::TurnStarted);
                    } else {
                        let completion_status = parse_turn_completion_status(status);
                        if completion_status == TurnCompletionStatus::Failed {
                            let message = extract_nested_string(turn, &["error", "message"])
                                .or_else(|| extract_nested_string(result, &["error", "message"]))
                                .unwrap_or_else(|| "Codex turn failed".to_string());
                            out.push(EngineEvent::Error {
                                message,
                                recoverable: false,
                            });
                        }
                        let token_usage =
                            extract_token_usage(result).or_else(|| self.latest_token_usage.clone());
                        out.push(EngineEvent::TurnCompleted {
                            token_usage,
                            status: completion_status,
                        });
                        self.latest_token_usage = None;
                    }
                }
            }
        }

        out
    }

    pub fn map_server_request(
        &mut self,
        request_id: &str,
        method: &str,
        params: &Value,
    ) -> Option<ApprovalRequest> {
        let normalized = normalize_method(method);

        let (action_type, summary) = match normalized.as_str() {
            "item/commandexecution/requestapproval" => (
                ActionType::Command,
                extract_any_string(params, &["reason", "command"])
                    .unwrap_or_else(|| "Approval required to run command".to_string()),
            ),
            "item/filechange/requestapproval" => (
                ActionType::FileEdit,
                extract_any_string(params, &["reason"])
                    .unwrap_or_else(|| "Approval required to apply file changes".to_string()),
            ),
            "execcommandapproval" => (
                ActionType::Command,
                extract_any_string(params, &["command"])
                    .unwrap_or_else(|| "Approval required to run command".to_string()),
            ),
            "applypatchapproval" => (
                ActionType::FileEdit,
                extract_any_string(params, &["reason"])
                    .unwrap_or_else(|| "Approval required to apply patch".to_string()),
            ),
            "item/tool/requestuserinput" | "tool/requestuserinput" => (
                ActionType::Other,
                extract_first_question_text(params)
                    .unwrap_or_else(|| "Codex requested user input".to_string()),
            ),
            "item/tool/call" => (
                ActionType::Other,
                extract_any_string(params, &["tool", "name"])
                    .map(|tool| format!("Codex requested dynamic tool call: {tool}"))
                    .unwrap_or_else(|| "Codex requested dynamic tool call".to_string()),
            ),
            _ => return None,
        };

        let approval_id = extract_any_string(params, &["approvalId", "itemId", "callId", "id"])
            .unwrap_or_else(|| request_id.to_string());

        let mut details = params.clone();
        if let Some(object) = details.as_object_mut() {
            object.insert(
                "_serverMethod".to_string(),
                Value::String(method.to_string()),
            );
        }

        Some(ApprovalRequest {
            approval_id: approval_id.clone(),
            server_method: normalized,
            event: EngineEvent::ApprovalRequested {
                approval_id,
                action_type,
                summary,
                details,
            },
        })
    }

    fn map_item_started(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(item) = params.get("item") else {
            return Vec::new();
        };

        let item_type =
            extract_any_string(item, &["type"]).unwrap_or_else(|| "unknown".to_string());

        match item_type.as_str() {
            "commandExecution" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());
                let summary = extract_any_string(item, &["command"])
                    .unwrap_or_else(|| "Run command".to_string());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Command,
                    summary,
                    details: item.clone(),
                }]
            }
            "fileChange" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());
                let summary = extract_first_change_path(item)
                    .map(|path| format!("Apply changes in {path}"))
                    .unwrap_or_else(|| "Apply file changes".to_string());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::FileEdit,
                    summary,
                    details: item.clone(),
                }]
            }
            "webSearch" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Search,
                    summary: "Web search".to_string(),
                    details: item.clone(),
                }]
            }
            "mcpToolCall" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Other,
                    summary: extract_any_string(item, &["name", "toolName"])
                        .unwrap_or_else(|| "Tool call".to_string()),
                    details: item.clone(),
                }]
            }
            "agentMessage" => Vec::new(),
            "plan" => {
                let text = extract_any_string(item, &["text"]).unwrap_or_default();
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content: text }]
                }
            }
            "reasoning" => {
                let content = join_string_array(item.get("summary").and_then(Value::as_array))
                    .or_else(|| join_string_array(item.get("content").and_then(Value::as_array)))
                    .unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            _ => Vec::new(),
        }
    }

    fn map_item_completed(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(item) = params.get("item") else {
            return Vec::new();
        };

        let item_type =
            extract_any_string(item, &["type"]).unwrap_or_else(|| "unknown".to_string());

        match item_type.as_str() {
            "commandExecution" | "fileChange" | "webSearch" | "mcpToolCall" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let Some(action_id) = self.resolve_action_for_completion(engine_item_id.as_deref())
                else {
                    return Vec::new();
                };

                let status = extract_any_string(item, &["status"])
                    .unwrap_or_else(|| "completed".to_string());
                let normalized_status = status.to_lowercase();
                let success = normalized_status == "completed";

                let output = extract_any_string(item, &["aggregatedOutput", "output", "text"]);
                let mut error = extract_item_error(item);
                if !success && error.is_none() {
                    error = Some(match normalized_status.as_str() {
                        "declined" => "Action was declined by user approval policy".to_string(),
                        "interrupted" => "Action was interrupted".to_string(),
                        other => format!("Action failed with status `{other}`"),
                    });
                }
                if !success {
                    if let Some(raw_error) = item.get("error") {
                        log::warn!(
                            "codex {item_type} completed with status={normalized_status}, raw_error={}",
                            raw_error
                        );
                    } else {
                        log::warn!(
                            "codex {item_type} completed with status={normalized_status} and no error payload"
                        );
                    }
                }
                let duration_ms =
                    extract_any_u64(item, &["durationMs", "duration_ms"]).unwrap_or(0);
                let diff = if item_type == "fileChange" {
                    extract_combined_diff(item)
                } else {
                    None
                };

                vec![EngineEvent::ActionCompleted {
                    action_id,
                    result: ActionResult {
                        success,
                        output,
                        error,
                        diff,
                        duration_ms,
                    },
                }]
            }
            "agentMessage" => {
                if let Some(item_id) = extract_any_string(item, &["id"]) {
                    if self.streamed_agent_message_items.remove(&item_id) {
                        return Vec::new();
                    }
                }
                let text = extract_any_string(item, &["text"]).unwrap_or_default();
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::TextDelta { content: text }]
                }
            }
            _ => Vec::new(),
        }
    }

    fn map_output_delta(&mut self, params: &Value) -> Option<EngineEvent> {
        let item_id = extract_any_string(params, &["itemId", "item_id", "id"])?;
        let action_id = self.resolve_action_for_output(Some(&item_id))?;

        let content = extract_any_string(params, &["delta", "output", "text", "content"])?;
        let stream_raw = extract_any_string(params, &["stream", "channel", "target"])
            .unwrap_or_else(|| "stdout".to_string());

        let stream = if stream_raw.to_lowercase().contains("err") {
            OutputStream::Stderr
        } else {
            OutputStream::Stdout
        };

        Some(EngineEvent::ActionOutputDelta {
            action_id,
            stream,
            content,
        })
    }

    fn resolve_or_register_action(&mut self, engine_action_id: Option<&str>) -> String {
        if let Some(engine_action_id) = engine_action_id {
            if let Some(existing) = self.engine_action_to_internal.get(engine_action_id) {
                return existing.clone();
            }
        }

        let action_id = format!("action-{}", Uuid::new_v4());
        if let Some(engine_action_id) = engine_action_id {
            self.engine_action_to_internal
                .insert(engine_action_id.to_string(), action_id.clone());
        } else {
            self.pending_actions_without_engine_id
                .push(action_id.clone());
        }
        action_id
    }

    fn resolve_action_for_output(&self, engine_action_id: Option<&str>) -> Option<String> {
        if let Some(value) = engine_action_id {
            return self.engine_action_to_internal.get(value).cloned();
        }

        self.pending_actions_without_engine_id.first().cloned()
    }

    fn resolve_action_for_completion(&mut self, engine_action_id: Option<&str>) -> Option<String> {
        if let Some(value) = engine_action_id {
            if let Some(existing) = self.engine_action_to_internal.get(value).cloned() {
                return Some(existing);
            }

            let synthetic = format!("action-{}", Uuid::new_v4());
            self.engine_action_to_internal
                .insert(value.to_string(), synthetic.clone());
            return Some(synthetic);
        }

        if self.pending_actions_without_engine_id.is_empty() {
            None
        } else {
            Some(self.pending_actions_without_engine_id.remove(0))
        }
    }
}

fn extract_item_error(item: &Value) -> Option<String> {
    if let Some(message) = extract_nested_string(item, &["error", "message"])
        .or_else(|| extract_nested_string(item, &["error", "reason"]))
        .or_else(|| extract_nested_string(item, &["error", "details"]))
        .or_else(|| extract_nested_string(item, &["error", "stderr"]))
        .or_else(|| extract_nested_string(item, &["error", "stdout"]))
    {
        return Some(message);
    }

    if let Some(error_value) = item.get("error") {
        if let Some(message) = error_value.as_str() {
            return Some(message.to_string());
        }

        if !error_value.is_null() {
            return Some(error_value.to_string());
        }
    }

    None
}

fn extract_turn_completion_status(params: &Value) -> TurnCompletionStatus {
    let status = params
        .get("turn")
        .and_then(|turn| turn.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("completed");
    parse_turn_completion_status(status)
}

fn render_plan_update(params: &Value) -> String {
    let mut lines = Vec::new();
    if let Some(explanation) = extract_any_string(params, &["explanation"]) {
        if !explanation.is_empty() {
            lines.push(explanation);
        }
    }

    if let Some(plan) = params.get("plan").and_then(Value::as_array) {
        for entry in plan {
            let Some(step) = extract_any_string(entry, &["step"]) else {
                continue;
            };
            let status =
                extract_any_string(entry, &["status"]).unwrap_or_else(|| "pending".to_string());
            lines.push(format!("- [{status}] {step}"));
        }
    }

    lines.join("\n")
}

fn parse_turn_completion_status(status: &str) -> TurnCompletionStatus {
    if status.eq_ignore_ascii_case("failed") {
        TurnCompletionStatus::Failed
    } else if status.eq_ignore_ascii_case("interrupted") {
        TurnCompletionStatus::Interrupted
    } else {
        TurnCompletionStatus::Completed
    }
}

fn extract_first_question_text(params: &Value) -> Option<String> {
    let questions = params.get("questions")?.as_array()?;
    let first = questions.first()?;
    extract_any_string(first, &["question", "header"])
}

fn extract_token_usage(value: &Value) -> Option<TokenUsage> {
    let mut candidates: Vec<&Value> = vec![value];

    if let Some(turn) = value.get("turn") {
        candidates.push(turn);
        if let Some(usage) = turn.get("usage") {
            candidates.push(usage);
        }
        if let Some(token_usage) = turn.get("tokenUsage") {
            candidates.push(token_usage);
            if let Some(last) = token_usage.get("last") {
                candidates.push(last);
            }
            if let Some(total) = token_usage.get("total") {
                candidates.push(total);
            }
        }
    }

    if let Some(token_usage) = value.get("tokenUsage") {
        candidates.push(token_usage);
        if let Some(last) = token_usage.get("last") {
            candidates.push(last);
        }
        if let Some(total) = token_usage.get("total") {
            candidates.push(total);
        }
    }

    for usage in candidates {
        let input = usage
            .get("input")
            .and_then(Value::as_u64)
            .or_else(|| usage.get("input_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("inputTokens").and_then(Value::as_u64))
            .or_else(|| usage.get("prompt_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("promptTokens").and_then(Value::as_u64));

        let output = usage
            .get("output")
            .and_then(Value::as_u64)
            .or_else(|| usage.get("output_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("outputTokens").and_then(Value::as_u64))
            .or_else(|| usage.get("completion_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("completionTokens").and_then(Value::as_u64));

        if let (Some(input), Some(output)) = (input, output) {
            return Some(TokenUsage { input, output });
        }
    }

    None
}

fn extract_combined_diff(item: &Value) -> Option<String> {
    let changes = item.get("changes")?.as_array()?;
    let mut diffs = Vec::new();

    for change in changes {
        if let Some(diff) = extract_any_string(change, &["diff"]) {
            if !diff.is_empty() {
                diffs.push(diff);
            }
        }
    }

    if diffs.is_empty() {
        None
    } else {
        Some(diffs.join("\n\n"))
    }
}

fn extract_first_change_path(item: &Value) -> Option<String> {
    item.get("changes")
        .and_then(Value::as_array)
        .and_then(|changes| changes.first())
        .and_then(|change| extract_any_string(change, &["path"]))
}

fn extract_any_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(string) = found.as_str() {
                return Some(string.to_string());
            }
            if found.is_number() || found.is_boolean() {
                return Some(found.to_string());
            }
        }
    }
    None
}

fn extract_any_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_u64() {
                return Some(number);
            }
            if let Some(number) = found.as_i64() {
                if number >= 0 {
                    return Some(number as u64);
                }
            }
            if let Some(number) = found.as_str().and_then(|value| value.parse::<u64>().ok()) {
                return Some(number);
            }
        }
    }
    None
}

fn extract_nested_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn normalize_method(method: &str) -> String {
    method.replace('.', "/").replace('_', "/").to_lowercase()
}

fn join_string_array(items: Option<&Vec<Value>>) -> Option<String> {
    let items = items?;
    let values = items
        .iter()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if values.is_empty() {
        None
    } else {
        Some(values.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn map_server_request_dynamic_tool_call_uses_call_id() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "callId": "call_abc",
            "tool": "my_tool",
            "arguments": { "query": "docs" }
        });

        let approval = mapper
            .map_server_request("request-1", "item/tool/call", &params)
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "call_abc");
        assert_eq!(approval.server_method, "item/tool/call");

        match approval.event {
            EngineEvent::ApprovalRequested {
                approval_id,
                action_type,
                summary,
                details,
            } => {
                assert_eq!(approval_id, "call_abc");
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "Codex requested dynamic tool call: my_tool");
                assert_eq!(
                    details.get("_serverMethod").and_then(Value::as_str),
                    Some("item/tool/call")
                );
            }
            _ => panic!("expected approval request event"),
        }
    }

    #[test]
    fn map_server_request_supports_tool_request_user_input_alias() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "itemId": "item_42",
            "questions": [
                {
                    "id": "lang",
                    "question": "Qual linguagem usar?",
                    "options": ["TypeScript"]
                }
            ]
        });

        let approval = mapper
            .map_server_request("request-2", "tool/requestUserInput", &params)
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "item_42");
        assert_eq!(approval.server_method, "tool/requestuserinput");

        match approval.event {
            EngineEvent::ApprovalRequested {
                action_type,
                summary,
                ..
            } => {
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "Qual linguagem usar?");
            }
            _ => panic!("expected approval request event"),
        }
    }
}
