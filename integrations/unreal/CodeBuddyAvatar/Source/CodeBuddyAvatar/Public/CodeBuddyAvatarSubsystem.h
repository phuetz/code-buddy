#pragma once

#include "CoreMinimal.h"
#include "CodeBuddyAvatarTypes.h"
#include "CodeBuddyWavParser.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Tickable.h"
#include "CodeBuddyAvatarSubsystem.generated.h"

class FJsonObject;
class IWebSocket;
class UAudioComponent;
class USoundWaveProcedural;

/**
 * Runtime owner for the authenticated Code Buddy avatar connection.
 *
 * It implements the V1 sequence/reconnect contract, reconstructs bounded
 * RIFF/WAVE streams, plays their PCM only after avatar.speech.started and
 * exposes restrained performance cues to the MetaHuman Blueprint.
 */
UCLASS(Config = CodeBuddyAvatar, DefaultConfig)
class CODEBUDDYAVATAR_API UCodeBuddyAvatarSubsystem final
    : public UGameInstanceSubsystem
    , public FTickableGameObject
{
    GENERATED_BODY()

public:
    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection")
    FString GatewayUrl = TEXT("ws://127.0.0.1:3055/ws");

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection")
    FString RendererId = TEXT("gpuNode-metahuman-lisa");

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection")
    FString DisplayName = TEXT("Lisa MetaHuman on GPU node");

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection")
    FString RuntimeVersion = TEXT("5.8");

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection")
    FString ProjectPath = TEXT("D:/DEV/AvatarStudio");

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection")
    bool bAutoConnect = true;

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection", meta = (ClampMin = "5.0", ClampMax = "30.0"))
    float HeartbeatSeconds = 15.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection", meta = (ClampMin = "0.5", ClampMax = "30.0"))
    float ReconnectInitialSeconds = 1.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Connection", meta = (ClampMin = "1.0", ClampMax = "120.0"))
    float ReconnectMaxSeconds = 30.0f;

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Audio")
    bool bAutoPlayAudio = true;

    /** Set true only after a healthy MetaHuman Audio Live Link subject is wired. */
    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|MetaHuman")
    bool bAudioDrivenAnimationEnabled = false;

    UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Code Buddy|Audio", meta = (ClampMin = "1048576", ClampMax = "67108864"))
    int32 MaxWavBytes = 16 * 1024 * 1024;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarConnectionEvent OnConnectionChanged;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarPhaseEvent OnPhaseChanged;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarCueEvent OnPerformanceCue;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarTextEvent OnSpeechText;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarWavEvent OnWavPrepared;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarSpeechEvent OnSpeechState;

    UPROPERTY(BlueprintAssignable, Category = "Code Buddy|Avatar")
    FCodeBuddyAvatarErrorEvent OnProtocolError;

    virtual void Initialize(FSubsystemCollectionBase& Collection) override;
    virtual void Deinitialize() override;

    virtual void Tick(float DeltaTime) override;
    virtual TStatId GetStatId() const override;
    virtual bool IsTickable() const override;
    virtual bool IsTickableWhenPaused() const override { return true; }

    UFUNCTION(BlueprintCallable, Category = "Code Buddy|Avatar")
    void Connect();

    UFUNCTION(BlueprintCallable, Category = "Code Buddy|Avatar")
    void Disconnect();

    /** Token is memory-only; use CODEBUDDY_AVATAR_TOKEN or call this at boot. */
    UFUNCTION(BlueprintCallable, Category = "Code Buddy|Avatar")
    void SetAuthenticationToken(const FString& Token);

    UFUNCTION(BlueprintCallable, Category = "Code Buddy|Avatar")
    void SetAudioDrivenAnimationReady(bool bReady);

    UFUNCTION(BlueprintCallable, Category = "Code Buddy|Avatar")
    void ReportMouthLatency(float LatencyMs);

    UFUNCTION(BlueprintCallable, Category = "Code Buddy|Avatar")
    void StopPlayback();

    UFUNCTION(BlueprintPure, Category = "Code Buddy|Avatar")
    bool IsRendererRegistered() const { return bRegistered; }

    UFUNCTION(BlueprintPure, Category = "Code Buddy|Avatar")
    ECodeBuddyAvatarPhase GetPhase() const { return Phase; }

    UFUNCTION(BlueprintPure, Category = "Code Buddy|Avatar")
    int64 GetLastSequence() const { return LastSequence; }

private:
    struct FIncomingAudio
    {
        FString TurnId;
        FString StreamId;
        int32 MaxChunkBytes = 48 * 1024;
        int32 NextChunkIndex = 0;
        int32 NextByteOffset = 0;
        TArray<TArray<uint8>> Chunks;
    };

    struct FPreparedAudio
    {
        FString TurnId;
        FString StreamId;
        FCodeBuddyWavData Wav;
    };

    TSharedPtr<IWebSocket> Socket;
    TMap<FString, FIncomingAudio> IncomingAudio;
    TArray<FPreparedAudio> PreparedAudio;
    TSet<FString> IgnoredTurnIds;

    UPROPERTY(Transient)
    TObjectPtr<UAudioComponent> ActiveAudioComponent;

    UPROPERTY(Transient)
    TObjectPtr<USoundWaveProcedural> ActiveSoundWave;

    FString AuthenticationToken;
    FString ActiveTurnId;
    ECodeBuddyAvatarPhase Phase = ECodeBuddyAvatarPhase::Unavailable;
    int64 LastSequence = -1;
    int32 DroppedAudioChunks = 0;
    float MouthLatencyMs = 0.0f;
    float SmoothedFps = 0.0f;
    int32 ActiveSampleRate = 0;
    int32 ActiveNumChannels = 0;
    double LastHeartbeatAt = 0.0;
    double NextReconnectAt = 0.0;
    int32 ReconnectAttempt = 0;
    uint64 ConnectionGeneration = 0;
    bool bTransportConnected = false;
    bool bRegistered = false;
    bool bSyncPending = false;
    bool bManualDisconnect = false;
    bool bAuthenticationBlocked = false;
    bool bSpeechStartReceived = false;
    bool bTurnCompletionReceived = false;

    void HandleSocketConnected(uint64 Generation);
    void HandleSocketClosed(uint64 Generation, int32 StatusCode, const FString& Reason, bool bWasClean);
    void HandleSocketError(uint64 Generation, const FString& Error);
    void HandleSocketMessage(uint64 Generation, const FString& Message);
    void HandleGatewayMessage(const FString& Message);
    void HandleSync(const TSharedPtr<FJsonObject>& Payload);
    void HandleAvatarEvent(const TSharedPtr<FJsonObject>& Event);

    void SendHello();
    void SendSync();
    void SendStatus();
    void SendJson(const TSharedRef<FJsonObject>& Message);
    void ScheduleReconnect();
    void FailAuthentication(const FString& Error);

    void BeginAudio(const TSharedPtr<FJsonObject>& Event, const FString& TurnId);
    void AppendAudioChunk(const TSharedPtr<FJsonObject>& Event);
    void EndAudio(const TSharedPtr<FJsonObject>& Event);
    void DropAudioStream(const FString& StreamId, const FString& Reason);
    void PlayNextPreparedAudio(const FString& TurnId);
    bool HasPreparedAudioForTurn(const FString& TurnId) const;
    void FinalizeCompletedTurn(const FString& TurnId);
    void StopActiveAudio();
    void ResetPlaybackState();
    FCodeBuddyAvatarCue ParseCue(const TSharedPtr<FJsonObject>& Event) const;
    void SetPhase(ECodeBuddyAvatarPhase NewPhase, const FString& Detail);
    static FString PhaseToWire(ECodeBuddyAvatarPhase Value);
    static bool IsTerminalEvent(const FString& Type);

    UFUNCTION()
    void HandleAudioFinished();
};
