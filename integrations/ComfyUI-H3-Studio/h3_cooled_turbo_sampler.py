import time

import torch

import comfy.samplers


COOLDOWN_START_STEP = 1
COOLDOWN_SECONDS = 15


def cooled_sampler(model, x, sigmas, extra_args=None, callback=None, disable=None, base_sampler=None, seconds=COOLDOWN_SECONDS, skip_last=False, **_kwargs):
    if base_sampler is None or not hasattr(base_sampler, "sampler_function"):
        raise ValueError("H3 Cooled Sampler requires a compatible base sampler")

    total_steps = len(sigmas) - 1

    def cooled_callback(state):
        if callback is not None:
            callback(state)

        completed_step = int(state["i"]) + 1
        if completed_step < COOLDOWN_START_STEP:
            return
        # the last step hands straight to the VAE, so pausing there only delays the result
        if skip_last and completed_step >= total_steps:
            return

        if x.device.type == "cuda":
            torch.cuda.synchronize(x.device)
        print(
            f"[H3 COOLED] Step {completed_step}/{total_steps} complete; "
            f"cooling CPU/GPU for {seconds} seconds...",
            flush=True,
        )
        time.sleep(seconds)

    return base_sampler.sampler_function(
        model,
        x,
        sigmas,
        extra_args={} if extra_args is None else extra_args,
        callback=cooled_callback,
        disable=disable,
        **base_sampler.extra_options,
    )


class H3CooledTurboSampler:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"sampler": ("SAMPLER",)},
            "optional": {
                "seconds": ("INT", {"default": COOLDOWN_SECONDS, "min": 0, "max": 600}),
                "skip_last": ("BOOLEAN", {"default": False, "tooltip": "Skip the pause after the final step."}),
            },
        }

    RETURN_TYPES = ("SAMPLER",)
    FUNCTION = "wrap"
    CATEGORY = "H3 Local Studio"
    DESCRIPTION = "Pauses for `seconds` (default 15) after every Turbo step."

    def wrap(self, sampler, seconds=COOLDOWN_SECONDS, skip_last=False):
        return (
            comfy.samplers.KSAMPLER(
                cooled_sampler,
                extra_options={"base_sampler": sampler, "seconds": seconds, "skip_last": skip_last},
                inpaint_options=sampler.inpaint_options,
            ),
        )


class H3CooledSampler(H3CooledTurboSampler):
    DESCRIPTION = "Pauses for `seconds` (default 15) after every sampling step."


NODE_CLASS_MAPPINGS = {
    "H3CooledSampler": H3CooledSampler,
    "H3CooledTurboSampler": H3CooledTurboSampler,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3CooledSampler": "H3 Cooled Sampler",
    "H3CooledTurboSampler": "H3 Cooled Turbo Sampler",
}
