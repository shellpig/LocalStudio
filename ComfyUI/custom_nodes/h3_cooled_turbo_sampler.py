import time

import torch

import comfy.samplers


COOLDOWN_START_STEP = 1
COOLDOWN_SECONDS = 12


def cooled_sampler(model, x, sigmas, extra_args=None, callback=None, disable=None, base_sampler=None, **_kwargs):
    if base_sampler is None or not hasattr(base_sampler, "sampler_function"):
        raise ValueError("H3 Cooled Sampler requires a compatible base sampler")

    total_steps = len(sigmas) - 1

    def cooled_callback(state):
        if callback is not None:
            callback(state)

        completed_step = int(state["i"]) + 1
        if completed_step < COOLDOWN_START_STEP:
            return

        if x.device.type == "cuda":
            torch.cuda.synchronize(x.device)
        print(
            f"[H3 COOLED] Step {completed_step}/{total_steps} complete; "
            f"cooling CPU/GPU for {COOLDOWN_SECONDS} seconds...",
            flush=True,
        )
        time.sleep(COOLDOWN_SECONDS)

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
        return {"required": {"sampler": ("SAMPLER",)}}

    RETURN_TYPES = ("SAMPLER",)
    FUNCTION = "wrap"
    CATEGORY = "H3 Local Studio"
    DESCRIPTION = "Pauses for 12 seconds after every Turbo step."

    def wrap(self, sampler):
        return (
            comfy.samplers.KSAMPLER(
                cooled_sampler,
                extra_options={"base_sampler": sampler},
                inpaint_options=sampler.inpaint_options,
            ),
        )


class H3CooledSampler(H3CooledTurboSampler):
    DESCRIPTION = "Pauses for 12 seconds after every sampling step."


NODE_CLASS_MAPPINGS = {
    "H3CooledSampler": H3CooledSampler,
    "H3CooledTurboSampler": H3CooledTurboSampler,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "H3CooledSampler": "H3 Cooled Sampler",
    "H3CooledTurboSampler": "H3 Cooled Turbo Sampler",
}
