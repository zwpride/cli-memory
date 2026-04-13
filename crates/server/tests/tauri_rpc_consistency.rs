use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use cc_switch_core::WEB_COMPAT_TAURI_COMMANDS;
use cc_switch_server::api::{PUBLIC_METHODS, RPC_BUSINESS_METHODS, WS_PROTOCOL_METHODS};

fn sorted_set<'a>(items: &'a [&'a str]) -> BTreeSet<&'a str> {
    items.iter().copied().collect()
}

fn dispatch_match_methods() -> BTreeSet<String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dispatch_path = manifest_dir.join("src/api/dispatch.rs");
    let source = fs::read_to_string(&dispatch_path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", dispatch_path.display()));

    let mut methods = BTreeSet::new();
    let bytes = source.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] != b'"' {
            i += 1;
            continue;
        }

        let start = i + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end] != b'"' {
            end += 1;
        }
        if end >= bytes.len() {
            break;
        }

        let mut cursor = end + 1;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }

        if cursor + 1 < bytes.len() && bytes[cursor] == b'=' && bytes[cursor + 1] == b'>' {
            methods.insert(source[start..end].to_string());
        }

        i = end + 1;
    }

    methods
}

#[test]
fn tauri_and_rpc_business_methods_stay_in_sync() {
    let tauri_methods = sorted_set(WEB_COMPAT_TAURI_COMMANDS);
    let rpc_methods = sorted_set(RPC_BUSINESS_METHODS);

    let missing_in_rpc: Vec<_> = tauri_methods.difference(&rpc_methods).copied().collect();
    assert!(
        missing_in_rpc.is_empty(),
        "web-compatible Tauri commands missing in RPC dispatch: {:?}",
        missing_in_rpc
    );

    let unexpected_rpc: Vec<_> = rpc_methods.difference(&tauri_methods).copied().collect();
    assert!(
        unexpected_rpc.is_empty(),
        "RPC business methods missing in Tauri compatibility list: {:?}",
        unexpected_rpc
    );
}

#[test]
fn protocol_method_whitelists_only_reference_live_entries() {
    let rpc_methods = sorted_set(RPC_BUSINESS_METHODS);
    let tauri_methods = sorted_set(WEB_COMPAT_TAURI_COMMANDS);
    let invoke_public = sorted_set(PUBLIC_METHODS);
    let ws_protocol = sorted_set(WS_PROTOCOL_METHODS);

    for method in PUBLIC_METHODS {
        assert!(
            !rpc_methods.contains(method),
            "public auth method {method} should stay out of RPC business methods"
        );
        assert!(
            !tauri_methods.contains(method),
            "public auth method {method} should stay out of Tauri compatibility methods"
        );
        assert!(
            invoke_public.contains(method),
            "public auth method whitelist contains stale entry {method}"
        );
    }

    for method in WS_PROTOCOL_METHODS {
        assert!(
            !rpc_methods.contains(method),
            "WS protocol method {method} should stay out of RPC business methods"
        );
        assert!(
            !tauri_methods.contains(method),
            "WS protocol method {method} should stay out of Tauri compatibility methods"
        );
        assert!(
            ws_protocol.contains(method),
            "WS protocol whitelist contains stale entry {method}"
        );
    }
}

#[test]
fn rpc_business_methods_have_real_dispatch_arms() {
    let dispatch_methods = dispatch_match_methods();
    let missing_dispatch: Vec<_> = RPC_BUSINESS_METHODS
        .iter()
        .copied()
        .filter(|method| !dispatch_methods.contains(*method))
        .collect();

    assert!(
        missing_dispatch.is_empty(),
        "RPC business methods missing match arms in dispatch.rs: {:?}",
        missing_dispatch
    );
}
