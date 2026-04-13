//! 共享代理基础模块。
//!
//! 本地代理/接管服务已经移除，当前仅保留仍被 Web/CLI 配置、
//! 身份认证、出站 HTTP 客户端和使用量计算依赖的公共模块。

pub mod circuit_breaker;
pub mod error;
pub mod http_client;
pub mod log_codes;
pub mod providers;
pub(crate) mod sse;
pub(crate) mod types;
pub mod usage;
