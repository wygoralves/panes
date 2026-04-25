use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone)]
pub enum IncomingMessage {
    Response(RpcResponse),
    Request {
        id: String,
        raw_id: Value,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

#[derive(Debug, Clone)]
pub struct RpcResponse {
    pub id: String,
    pub result: Option<Value>,
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    #[serde(default)]
    pub code: Option<i64>,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.code {
            Some(code) => write!(f, "rpc error {code}: {}", self.message),
            None => write!(f, "rpc error: {}", self.message),
        }
    }
}

impl std::error::Error for RpcError {}

pub fn parse_incoming(line: &str) -> anyhow::Result<IncomingMessage> {
    let payload: Value = serde_json::from_str(line)
        .map_err(|error| anyhow::anyhow!("invalid JSON line: {error}; line={line}"))?;

    let Value::Object(mut object) = payload else {
        return Err(anyhow::anyhow!("incoming payload is not a JSON object"));
    };

    let method = object.remove("method").and_then(value_into_string);

    if let Some(method) = method {
        let raw_id_value = object.remove("id");
        let id = raw_id_value.as_ref().and_then(normalize_id);
        let params = object
            .remove("params")
            .unwrap_or_else(|| Value::Object(Map::new()));

        if let Some(id) = id {
            let raw_id = raw_id_value.unwrap_or_else(|| Value::String(id.clone()));
            return Ok(IncomingMessage::Request {
                id,
                raw_id,
                method,
                params,
            });
        }

        return Ok(IncomingMessage::Notification { method, params });
    }

    if let Some(id) = object.remove("id").and_then(normalize_id_owned) {
        let result = object.remove("result");
        let error = object
            .remove("error")
            .and_then(|raw| serde_json::from_value::<RpcError>(raw).ok());

        return Ok(IncomingMessage::Response(RpcResponse { id, result, error }));
    }

    Err(anyhow::anyhow!(
        "incoming payload is neither request/notification nor response"
    ))
}

pub fn request_payload(id: &str, method: &str, params: Value) -> Value {
    serde_json::json!({
      "id": id,
      "method": method,
      "params": params,
    })
}

pub fn notification_payload(method: &str, params: Value) -> Value {
    serde_json::json!({
      "method": method,
      "params": params,
    })
}

pub fn response_success_payload(id: &Value, result: Value) -> Value {
    serde_json::json!({
      "id": id,
      "result": result,
    })
}

pub fn response_error_payload(id: &Value, code: i64, message: &str, data: Option<Value>) -> Value {
    serde_json::json!({
      "id": id,
      "error": {
        "code": code,
        "message": message,
        "data": data,
      }
    })
}

fn normalize_id(raw: &Value) -> Option<String> {
    match raw {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn normalize_id_owned(raw: Value) -> Option<String> {
    match raw {
        Value::String(value) => Some(value),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_into_string(value: Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_notification_without_cloning_params() {
        let message = parse_incoming(
            r#"{"method":"thread/updated","params":{"threadId":"t1","payload":{"nested":true}}}"#,
        )
        .expect("notification should parse");

        match message {
            IncomingMessage::Notification { method, params } => {
                assert_eq!(method, "thread/updated");
                assert_eq!(
                    params,
                    json!({
                        "threadId": "t1",
                        "payload": {
                            "nested": true,
                        },
                    })
                );
            }
            other => panic!("expected notification, got {other:?}"),
        }
    }

    #[test]
    fn parses_request_with_raw_numeric_id() {
        let message =
            parse_incoming(r#"{"id":42,"method":"serverRequest","params":{"kind":"approval"}}"#)
                .expect("request should parse");

        match message {
            IncomingMessage::Request {
                id,
                raw_id,
                method,
                params,
            } => {
                assert_eq!(id, "42");
                assert_eq!(raw_id, json!(42));
                assert_eq!(method, "serverRequest");
                assert_eq!(params, json!({ "kind": "approval" }));
            }
            other => panic!("expected request, got {other:?}"),
        }
    }

    #[test]
    fn parses_response_with_result() {
        let message = parse_incoming(r#"{"id":"7","result":{"data":[{"id":"model-a"}]}}"#)
            .expect("response should parse");

        match message {
            IncomingMessage::Response(response) => {
                assert_eq!(response.id, "7");
                assert_eq!(
                    response.result,
                    Some(json!({ "data": [{ "id": "model-a" }] }))
                );
                assert!(response.error.is_none());
            }
            other => panic!("expected response, got {other:?}"),
        }
    }

    #[test]
    fn parses_response_with_error_without_result() {
        let message = parse_incoming(
            r#"{"id":"8","error":{"code":-32603,"message":"boom","data":{"retry":false}}}"#,
        )
        .expect("error response should parse");

        match message {
            IncomingMessage::Response(response) => {
                assert_eq!(response.id, "8");
                assert!(response.result.is_none());
                let error = response.error.expect("error should be present");
                assert_eq!(error.code, Some(-32603));
                assert_eq!(error.message, "boom");
                assert_eq!(error.data, Some(json!({ "retry": false })));
            }
            other => panic!("expected response, got {other:?}"),
        }
    }

    #[test]
    fn defaults_missing_params_to_empty_object() {
        let message =
            parse_incoming(r#"{"method":"runtime/ready"}"#).expect("notification should parse");

        match message {
            IncomingMessage::Notification { params, .. } => {
                assert_eq!(params, json!({}));
            }
            other => panic!("expected notification, got {other:?}"),
        }
    }
}
