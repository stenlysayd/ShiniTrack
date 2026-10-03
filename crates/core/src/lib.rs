//! ShiniTrack core: everything that is shared between the Android app and the
//! polling server.
//!
//! * [`api`]     – async client for the (unofficial) Shinigami API `api.shngm.io/v1`
//! * [`models`]  – serde models for API payloads and app-level events
//! * [`detect`]  – pure "is there a new chapter for one of MY favorites?" logic
//! * [`predict`] – release-schedule prediction from chapter history
//! * [`store`]   – SQLite persistence (favorites, events, history, downloads)

pub mod api;
pub mod detect;
pub mod error;
pub mod models;
pub mod predict;
pub mod store;

pub use api::ShinigamiClient;
pub use error::{Error, Result};
