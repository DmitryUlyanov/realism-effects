varying vec2 vUv;

uniform sampler2D depthTexture;
uniform sampler2D normalTexture;
uniform sampler2D velocityTexture;
uniform sampler2D accumulatedTexture;
uniform vec3 color;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 inverseProjectionMatrix;
uniform mat4 projectionViewMatrix;
uniform mat4 cameraMatrixWorld;
uniform int frame;

uniform sampler2D blueNoiseTexture;
uniform vec2 blueNoiseRepeat;
uniform vec2 texSize;

uniform float aoDistance;
uniform float distancePower;
uniform float bias;
uniform float thickness;

#include <packing>
// HBAO Utils
#include <hbao_utils>

float getOcclusion(const vec3 worldPos, const vec3 worldNormal, const float depth, const int seed, out vec3 sampleWorldDir) {
    float occlusion = 0.0;

    vec4 blueNoise = sampleBlueNoise(blueNoiseTexture, seed, blueNoiseRepeat, texSize);

    sampleWorldDir = sampleHemisphere(worldNormal, blueNoise.rg);
    vec3 sampleWorldPos = worldPos + aoDistance * pow(blueNoise.b, distancePower) * sampleWorldDir;

    // Project the sample position to screen space
    vec4 sampleUv = projectionViewMatrix * vec4(sampleWorldPos, 1.);
    sampleUv.xy /= sampleUv.w;
    sampleUv.xy = sampleUv.xy * 0.5 + 0.5;

    // Get the depth of the sample position
    float sampleUnpackedDepth = textureLod(depthTexture, sampleUv.xy, 0.0).r;
    float sampleDepth = -getViewZ(sampleUnpackedDepth);

    // Compute the horizon line
    float deltaDepth = depth - sampleDepth;

    if (deltaDepth < thickness) {
        float horizon = sampleDepth + deltaDepth * bias;

        float occlusionSample = max(0.0, horizon - depth);
        occlusion += occlusionSample * dot(worldNormal, sampleWorldDir);
    }

    return occlusion;
}

vec3 slerp(vec3 a, vec3 b, float t) {
    float cosAngle = dot(a, b);
    float angle = acos(cosAngle);

    if (abs(angle) < 0.001) {
        return mix(a, b, t);
    }

    float sinAngle = sin(angle);
    float t1 = sin((1.0 - t) * angle) / sinAngle;
    float t2 = sin(t * angle) / sinAngle;

    return (a * t1) + (b * t2);
}

void main() {
    float unpackedDepth = textureLod(depthTexture, vUv, 0.0).r;

    // filter out background
    if (unpackedDepth > 0.9999) {
        discard;
        return;
    }

    vec3 worldPos = getWorldPos(unpackedDepth, vUv);

#ifdef useNormalTexture
    vec3 worldNormal = unpackRGBToNormal(textureLod(normalTexture, vUv, 0.).rgb);

    worldNormal = (vec4(worldNormal, 1.) * viewMatrix).xyz;  // view-space to world-space
#else
    vec3 worldNormal = computeWorldNormal(vUv, unpackedDepth);  // compute world normal from depth
#endif

    float depth = -getViewZ(unpackedDepth);

    vec3 sampleWorldDir;
    float ao = 0.0;
    float totalWeight = 0.0;

    for (int i = 0; i < spp; i++) {
        float occlusion = getOcclusion(worldPos, worldNormal, depth, frame + i, sampleWorldDir);

        float visibility = 1. - occlusion;
        ao += visibility;

#ifdef bentNormals
        float w = visibility / (totalWeight == 0. ? 1. : totalWeight);
        worldNormal = slerp(worldNormal, sampleWorldDir, w);
        worldNormal = normalize(worldNormal);

        totalWeight += visibility;
#endif
    }

    ao /= float(spp);

    vec3 aoColor = mix(color, vec3(1.), ao);

    gl_FragColor = vec4(aoColor, 1.);
}
