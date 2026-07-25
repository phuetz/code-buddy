import json
import os
import tempfile
import unittest

from identity import (
    IdentityMatch,
    cosine_similarity,
    load_embedding_store,
    match_identity,
    parse_embedding_store,
    stable_identity_match,
)


def vector(*values):
    return list(values)


class CosineMatchingTests(unittest.TestCase):
    def test_cosine_similarity_handles_same_orthogonal_and_opposite_vectors(self):
        self.assertAlmostEqual(cosine_similarity(vector(1, 0), vector(1, 0)), 1.0)
        self.assertAlmostEqual(cosine_similarity(vector(1, 0), vector(0, 1)), 0.0)
        self.assertAlmostEqual(cosine_similarity(vector(1, 0), vector(-1, 0)), -1.0)

    def test_best_enrolled_sample_must_reach_the_threshold(self):
        enrolled = {
            "Alice": [vector(1, 0), vector(0.8, 0.2)],
            "Bob": [vector(0, 1)],
        }
        match = match_identity(vector(0.9, 0.1), enrolled, threshold=0.9)
        self.assertEqual(match.name, "Alice")
        self.assertGreater(match.similarity, 0.99)
        self.assertIsNone(
            match_identity(vector(1, 1), enrolled, threshold=0.99)
        )


class StabilityTests(unittest.TestCase):
    def test_requires_two_latest_concordant_frames(self):
        alice_one = IdentityMatch("Alice", 0.61)
        alice_two = IdentityMatch("alice", 0.65)
        bob = IdentityMatch("Bob", 0.8)
        self.assertIsNone(stable_identity_match([alice_one], 2))
        self.assertIsNone(stable_identity_match([alice_one, bob], 2))
        stable = stable_identity_match([bob, alice_one, alice_two], 2)
        self.assertEqual(stable.name, "alice")
        self.assertAlmostEqual(stable.similarity, 0.63)
        self.assertIsNone(stable_identity_match([alice_one, None], 2))


class EmbeddingStoreFormatTests(unittest.TestCase):
    def test_loads_name_to_multiple_512d_embeddings(self):
        first = [1.0] + [0.0] * 511
        second = [0.0, 1.0] + [0.0] * 510
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "embeddings.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"Alice": [first, second]}, handle)
            loaded = load_embedding_store(path)
        self.assertEqual(list(loaded), ["Alice"])
        self.assertEqual(len(loaded["Alice"]), 2)
        self.assertEqual(len(loaded["Alice"][0]), 512)
        self.assertAlmostEqual(sum(value * value for value in loaded["Alice"][0]), 1.0)

    def test_rejects_wrong_shape_and_empty_identity_lists(self):
        with self.assertRaises(ValueError):
            parse_embedding_store({"Alice": [[1.0, 0.0]]})
        with self.assertRaises(ValueError):
            parse_embedding_store({"Alice": []})
        with self.assertRaises(ValueError):
            parse_embedding_store(["not", "an", "object"])


if __name__ == "__main__":
    unittest.main()
