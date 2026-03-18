import * as ex from 'excalibur';

/**
 * Light data for the fog of war shader.
 * Positions are in screen-space pixels (not world-space).
 */
export interface FogLight {
  /** Screen-space X position in pixels */
  x: number;
  /** Screen-space Y position in pixels */
  y: number;
  /** Radius of the light in pixels */
  radius: number;
  /** Light intensity 0..1 (how much darkness is removed at center) */
  intensity: number;
  /** Softness 0..1 (size of the bright inner core as fraction of radius) */
  softness: number;
  /** Tint color — RGBA, each channel 0..1 */
  tintR: number;
  tintG: number;
  tintB: number;
  tintA: number;
}

const MAX_LIGHTS = 16;

// GLSL 300 es fragment shader — ported from the Phaser 3 version.
// Key differences from the original:
//   - `#version 300 es` header
//   - `in` instead of `varying`
//   - `out vec4 fragColor` instead of `gl_FragColor`
//   - `texture()` instead of `texture2D()`
//   - Built-in uniform `u_image` replaces `uMainSampler`
//   - Built-in uniform `u_resolution` replaces `uResolution`
const FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

// Excalibur built-in uniforms
uniform sampler2D u_image;
uniform vec2 u_resolution;

// Excalibur provides this varying for screen UV coords
in vec2 v_texcoord;
out vec4 fragColor;

// Custom uniforms
uniform int u_lightCount;
uniform float u_lightX[${MAX_LIGHTS}];
uniform float u_lightY[${MAX_LIGHTS}];
uniform float u_lightRadius[${MAX_LIGHTS}];
uniform float u_lightIntensity[${MAX_LIGHTS}];
uniform float u_lightSoftness[${MAX_LIGHTS}];
uniform float u_tintR[${MAX_LIGHTS}];
uniform float u_tintG[${MAX_LIGHTS}];
uniform float u_tintB[${MAX_LIGHTS}];
uniform float u_tintA[${MAX_LIGHTS}];

void main() {
    vec4 sceneColor = texture(u_image, v_texcoord);

    // Convert UV to pixel coordinates.
    // Flip Y because screen UV (0,0) is top-left but game coords have Y increasing downward.
    vec2 fragPixel = vec2(v_texcoord.x, 1.0 - v_texcoord.y) * u_resolution;

    float darkness = 1.0;
    vec3 warmTint = vec3(0.0);

    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
        if (i >= u_lightCount) break;

        float radius = u_lightRadius[i];
        float intensity = u_lightIntensity[i];
        float softness = u_lightSoftness[i];
        vec2 lightPos = vec2(u_lightX[i], u_lightY[i]);

        float dist = distance(fragPixel, lightPos);
        if (dist >= radius) continue;

        float t = dist / radius;
        float falloff;

        if (t <= softness) {
            // Bright inner core
            falloff = mix(intensity, intensity * 0.8, t / max(softness, 0.01));
        } else if (t <= 0.75) {
            // Mid-range falloff
            falloff = mix(intensity * 0.8, 0.3, (t - softness) / max(0.75 - softness, 0.01));
        } else {
            // Outer fade to zero
            falloff = mix(0.3, 0.0, (t - 0.75) / 0.25);
        }

        // Multiplicative blending — overlapping lights combine naturally
        darkness *= (1.0 - falloff);

        float tintFalloff = smoothstep(1.0, 0.0, t);
        warmTint += vec3(u_tintR[i], u_tintG[i], u_tintB[i]) * u_tintA[i] * tintFalloff;
    }

    darkness = clamp(darkness, 0.0, 1.0);

    // Near-black fog color (2, 1, 5) / 255
    vec3 darkColor = vec3(2.0 / 255.0, 1.0 / 255.0, 5.0 / 255.0);
    vec3 finalColor = mix(sceneColor.rgb, darkColor, darkness) + warmTint;

    fragColor = vec4(finalColor, sceneColor.a);
}
`;

/**
 * Fog of war post-processor for Excalibur.js v0.30.x.
 *
 * Applies a full-screen darkness overlay with per-light cutouts.
 * Each light punches a soft hole through the fog with configurable
 * radius, intensity, softness, and color tint.
 *
 * Usage:
 *   const fog = new FogOfWarPostProcessor();
 *   engine.graphicsContext.addPostProcessor(fog);
 *
 *   // Each frame (e.g. in Scene.onPreDraw or onPostUpdate):
 *   fog.setLights(activeLights);
 */
export class FogOfWarPostProcessor implements ex.PostProcessor {
  private _shader!: ex.ScreenShader;
  private _lights: FogLight[] = [];

  /**
   * Called once by Excalibur when the graphics context is ready.
   * Creates the ScreenShader (which compiles the GLSL program).
   */
  initialize(gl: WebGL2RenderingContext): void {
    this._shader = new ex.ScreenShader(gl as any, FRAGMENT_SOURCE);
  }

  getLayout(): ex.VertexLayout {
    return this._shader.getLayout();
  }

  getShader(): ex.Shader {
    return this._shader.getShader();
  }

  /**
   * Set the active lights for this frame.
   * Pass coordinates in CSS screen-space pixels (from worldToScreenCoordinates).
   * PostProcessor handles DPR scaling internally — caller doesn't need to know.
   */
  setLights(lights: FogLight[]): void {
    // Scale from CSS pixels to physical pixels (shader's u_resolution is physical)
    const dpr = window.devicePixelRatio || 1;
    this._lights = lights.map(l => ({
      ...l,
      x: l.x * dpr,
      y: l.y * dpr,
      radius: l.radius * dpr,
    }));
  }

  /**
   * Called by Excalibur every frame after the shader is bound.
   * Uploads all light uniforms to the GPU.
   */
  onUpdate(_elapsed: number): void {
    const shader = this._shader.getShader();
    const count = Math.min(this._lights.length, MAX_LIGHTS);

    shader.trySetUniformInt('u_lightCount', count);

    // Upload per-light arrays.
    // We build full-size arrays (length 16) because GLSL arrays are fixed-size.
    const xs = new Array<number>(MAX_LIGHTS).fill(0);
    const ys = new Array<number>(MAX_LIGHTS).fill(0);
    const radii = new Array<number>(MAX_LIGHTS).fill(0);
    const intensities = new Array<number>(MAX_LIGHTS).fill(0);
    const softnesses = new Array<number>(MAX_LIGHTS).fill(0);
    const tintRs = new Array<number>(MAX_LIGHTS).fill(0);
    const tintGs = new Array<number>(MAX_LIGHTS).fill(0);
    const tintBs = new Array<number>(MAX_LIGHTS).fill(0);
    const tintAs = new Array<number>(MAX_LIGHTS).fill(0);

    for (let i = 0; i < count; i++) {
      const light = this._lights[i];
      xs[i] = light.x;
      ys[i] = light.y;
      radii[i] = light.radius;
      intensities[i] = light.intensity;
      softnesses[i] = light.softness;
      tintRs[i] = light.tintR;
      tintGs[i] = light.tintG;
      tintBs[i] = light.tintB;
      tintAs[i] = light.tintA;
    }

    shader.trySetUniformFloatArray('u_lightX', xs);
    shader.trySetUniformFloatArray('u_lightY', ys);
    shader.trySetUniformFloatArray('u_lightRadius', radii);
    shader.trySetUniformFloatArray('u_lightIntensity', intensities);
    shader.trySetUniformFloatArray('u_lightSoftness', softnesses);
    shader.trySetUniformFloatArray('u_tintR', tintRs);
    shader.trySetUniformFloatArray('u_tintG', tintGs);
    shader.trySetUniformFloatArray('u_tintB', tintBs);
    shader.trySetUniformFloatArray('u_tintA', tintAs);
  }
}
