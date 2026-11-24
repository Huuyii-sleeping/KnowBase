"""Plan length-sorted batches within one request, retaining original offsets."""


def length_batches(windows, batch_size):
    if (
        not isinstance(batch_size, int)
        or isinstance(batch_size, bool)
        or batch_size < 1
    ):
        raise ValueError("batch size must be a positive integer")
    order = sorted(range(len(windows)), key=lambda i: len(windows[i]["input_ids"]))
    for start in range(0, len(order), batch_size):
        yield order[start : start + batch_size]
