# Email threading

Threading does not use the subject.

`resolveThreadKey` chooses the first match:

1. The provider thread id on the message, when present.
2. `In-Reply-To`, then `References`, matched to an `Internet Message-ID` already stored in the same mailbox.
3. A new key, `rfc:` plus the message's own Message-ID, or `local:` plus random bytes when no Message-ID exists.

Gmail thread ids and Microsoft conversation ids are stored in `provider_thread_id` and are not converted into each other.

The integration test imports a reply with a different subject and `In-Reply-To` set to the first message. Those two rows share one thread. A third message with no reference stays on its own thread.
