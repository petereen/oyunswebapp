import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import main as backend_main
from fastapi import HTTPException
from models import AdminUserMessageRequest
from telegram import TelegramDeliveryError


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.filters = None

    def select(self, columns, **_kwargs):
        self.columns = columns
        return self

    def or_(self, filters):
        self.filters = filters
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def in_(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def range(self, *_args, **_kwargs):
        return self

    def insert(self, _payload):
        return self

    def execute(self):
        if self.table_name == "users":
            if "username" in self.columns and self.client.username_missing:
                raise RuntimeError("column users.username does not exist")
            if self.filters is not None:
                self.client.filters.append(self.filters)
            return SimpleNamespace(data=self.client.users)
        if self.table_name == "transactions":
            return SimpleNamespace(data=self.client.transactions)
        return SimpleNamespace(data=[])


class FakeClient:
    def __init__(self, users=(), transactions=(), username_missing=False):
        self.users = list(users)
        self.transactions = list(transactions)
        self.username_missing = username_missing
        self.filters = []

    def table(self, name):
        return FakeQuery(self, name)


USERS = [
    {"id": 111, "first_name": "Бат", "last_name": "Эрдэнэ", "username": "bat_e", "phone": "+79991112233", "phone_mnt": "99112233", "phone_intl": "+97699112233", "email": "bat@example.com"},
    {"id": 222, "first_name": "Эрдэнэ", "last_name": "Сүх", "username": None, "phone": None, "phone_mnt": "88001122", "phone_intl": None, "email": None},
    {"id": 333, "first_name": "Оюун", "last_name": "Бат", "username": "oyuun", "phone": None, "phone_mnt": None, "phone_intl": None, "email": None},
]


class UserSearchTokenTests(unittest.TestCase):
    def test_full_name_is_split_into_tokens_in_any_order(self):
        self.assertEqual(backend_main._user_search_tokens("  Бат   Эрдэнэ "), ["бат", "эрдэнэ"])

    def test_phone_with_punctuation_becomes_one_numeric_token(self):
        self.assertEqual(backend_main._user_search_tokens("+976 9911-2233"), ["97699112233"])

    def test_leading_at_sign_is_removed(self):
        self.assertEqual(backend_main._user_search_tokens("@Oyuns_Finance"), ["oyuns_finance"])

    def test_filter_breaking_characters_are_removed(self):
        tokens = backend_main._user_search_tokens("bat,first_name.eq.1) %*\\ \"x\"")
        for token in tokens:
            self.assertFalse(set(token) & set(',()%*\\"'), token)

    def test_empty_and_symbol_only_queries_produce_no_tokens(self):
        self.assertEqual(backend_main._user_search_tokens(""), [])
        self.assertEqual(backend_main._user_search_tokens(" %,() "), [])


class UserSearchRankingTests(unittest.TestCase):
    def search(self, query, users=USERS, **client_kwargs):
        client = FakeClient(users=users, **client_kwargs)
        return client, backend_main._search_users(client, query)

    def test_exact_id_ranks_first(self):
        _, rows = self.search("111")
        self.assertEqual(rows[0]["id"], 111)

    def test_two_word_name_requires_both_words_and_ignores_order(self):
        _, rows = self.search("Эрдэнэ Бат")
        self.assertEqual([row["id"] for row in rows], [111])

    def test_single_word_matches_first_or_last_name_with_prefix_first(self):
        _, rows = self.search("бат")
        self.assertEqual({row["id"] for row in rows}, {111, 333})
        # "Бат" is the first name of 111 and the last name of 333; both prefix-match.
        self.assertEqual(len(rows), 2)

    def test_phone_digits_are_not_mistaken_for_an_id(self):
        client, rows = self.search("99112233")
        self.assertEqual([row["id"] for row in rows], [111])
        self.assertIn("phone_mnt.ilike.%99112233%", client.filters[0])

    def test_phone_with_country_code_matches_local_number(self):
        _, rows = self.search("+976 99112233")
        self.assertEqual([row["id"] for row in rows], [111])

    def test_username_with_at_sign(self):
        _, rows = self.search("@bat_e")
        self.assertEqual([row["id"] for row in rows], [111])

    def test_email_fragment(self):
        _, rows = self.search("bat@example")
        self.assertEqual([row["id"] for row in rows], [111])

    def test_falls_back_when_username_column_is_missing(self):
        users = [{k: v for k, v in USERS[0].items() if k != "username"}]
        client, rows = self.search("Бат", users=users, username_missing=True)
        self.assertEqual([row["id"] for row in rows], [111])
        self.assertNotIn("username", client.filters[0])

    def test_candidates_that_miss_a_token_are_dropped(self):
        _, rows = self.search("Бат Сүх")
        self.assertEqual(rows, [])

    def test_empty_query_returns_recent_users_without_filtering(self):
        client, rows = self.search("")
        self.assertEqual(len(rows), 3)
        self.assertEqual(client.filters, [])


class TransactionCountTests(unittest.TestCase):
    def test_counts_are_grouped_in_one_query(self):
        client = FakeClient(transactions=[{"user_id": 111}, {"user_id": 111}, {"user_id": 222}, {"user_id": 999}])
        counts = backend_main._count_transactions_by_user(client, [111, 222, 333])
        self.assertEqual(counts, {111: 2, 222: 1, 333: 0})


class UserMessageTests(unittest.TestCase):
    def send(self, user_id=111, template="contact_support", users=USERS, send_side_effect=None):
        client = FakeClient(users=[u for u in users if u["id"] == user_id])
        calls = {"sent": [], "audit": []}

        def fake_send(chat_id, text, reply_markup=None):
            if send_side_effect:
                raise send_side_effect
            calls["sent"].append((chat_id, text, reply_markup))
            return 4242

        with patch.object(backend_main, "get_supabase", return_value=client), \
             patch.object(backend_main, "send_user_message", side_effect=fake_send), \
             patch.object(backend_main, "log_admin_action", side_effect=lambda **kw: calls["audit"].append(kw)):
            result = asyncio.run(
                backend_main.admin_send_user_message(user_id, AdminUserMessageRequest(template=template), SimpleNamespace(id=77))
            )
        return result, calls

    def test_template_is_sent_with_formatting_and_contact_button(self):
        result, calls = self.send()
        self.assertEqual(result.telegram_message_id, 4242)
        chat_id, text, markup = calls["sent"][0]
        self.assertEqual(chat_id, 111)
        self.assertIn("<b>Уучлаарай</b>", text)
        self.assertIn("Админ тантай холбогдож чадаагүй тул та дараах хаягаар бидэнтэй холбогдоно уу.", text)
        self.assertIn("@oyuns_finance", text)
        self.assertEqual(markup["inline_keyboard"][0][0]["url"], "https://t.me/OYUNS_Finance")
        self.assertEqual(calls["audit"][0]["action_type"], "user_message")
        self.assertEqual(calls["audit"][0]["admin_user_id"], 77)

    def test_unknown_template_is_rejected_before_any_lookup(self):
        with self.assertRaises(HTTPException) as context:
            self.send(template="nope")
        self.assertEqual(context.exception.status_code, 400)

    def test_unknown_user_returns_404(self):
        with self.assertRaises(HTTPException) as context:
            self.send(user_id=999)
        self.assertEqual(context.exception.status_code, 404)

    def test_blocked_bot_returns_422(self):
        error = TelegramDeliveryError("Forbidden: bot was blocked by the user", unreachable=True)
        with self.assertRaises(HTTPException) as context:
            self.send(send_side_effect=error)
        self.assertEqual(context.exception.status_code, 422)

    def test_other_telegram_failures_return_502(self):
        with self.assertRaises(HTTPException) as context:
            self.send(send_side_effect=TelegramDeliveryError("Bad Gateway"))
        self.assertEqual(context.exception.status_code, 502)

    def test_templates_endpoint_returns_preview_matching_sent_text(self):
        response = asyncio.run(backend_main.admin_user_message_templates(SimpleNamespace(id=77)))
        template = response.templates[0]
        self.assertEqual(template.id, "contact_support")
        self.assertIn("@oyuns_finance", template.preview)


if __name__ == "__main__":
    unittest.main()
