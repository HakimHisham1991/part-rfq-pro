using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ThreeDAnalyzer.Web.Data;
using ThreeDAnalyzer.Web.Data.Entities;

namespace ThreeDAnalyzer.Web.Api;

[ApiController]
[Route("api/machine-profiles")]
public class MachineProfilesController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<MachineProfileDto>>> List()
    {
        var items = await db.MachineProfiles.OrderBy(m => m.Name).ToListAsync();
        return items.Select(m => m.ToDto()).ToList();
    }

    [HttpPost]
    public async Task<ActionResult<MachineProfileDto>> Create([FromBody] CreateMachineProfileRequest request)
    {
        var name = (request.Name ?? "").Trim();
        var createdBy = (request.CreatedBy ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(name))
            return BadRequest("Machine name is required.");
        if (string.IsNullOrEmpty(createdBy))
            return BadRequest("Created by is required.");
        if (!DateOnly.TryParse(request.CreatedDate, out var createdDate))
            return BadRequest("Created date is invalid.");

        if (request.RapidRateMmpm < 0)
            return BadRequest("Rapid rate must be zero or greater.");
        if (request.SpindlePowerKw < 0)
            return BadRequest("Spindle power must be zero or greater.");
        if (request.AccelDecelFactor <= 0)
            return BadRequest("Acceleration/deceleration factor must be greater than zero.");
        if (request.ToolChangeTimeSec < 0)
            return BadRequest("Tool change time must be zero or greater.");

        if (await db.MachineProfiles.AnyAsync(m => m.Name == name))
            return BadRequest("Machine name already exists.");

        var profile = new MachineProfile
        {
            Name = name,
            RapidRateMmpm = request.RapidRateMmpm,
            SpindlePowerKw = request.SpindlePowerKw,
            AccelDecelFactor = request.AccelDecelFactor,
            ToolChangeTimeSec = request.ToolChangeTimeSec,
            CreatedBy = createdBy,
            CreatedDate = createdDate,
            Status = status
        };

        db.MachineProfiles.Add(profile);
        await db.SaveChangesAsync();
        return StatusCode(StatusCodes.Status201Created, profile.ToDto());
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<MachineProfileDto>> Update(int id, [FromBody] UpdateMachineProfileRequest request)
    {
        var profile = await db.MachineProfiles.FindAsync(id);
        if (profile == null) return NotFound();

        var createdBy = (request.CreatedBy ?? "").Trim();
        var status = NormalizeStatus(request.Status);

        if (string.IsNullOrEmpty(createdBy))
            return BadRequest("Created by is required.");
        if (!DateOnly.TryParse(request.CreatedDate, out var createdDate))
            return BadRequest("Created date is invalid.");

        if (request.RapidRateMmpm < 0)
            return BadRequest("Rapid rate must be zero or greater.");
        if (request.SpindlePowerKw < 0)
            return BadRequest("Spindle power must be zero or greater.");
        if (request.AccelDecelFactor <= 0)
            return BadRequest("Acceleration/deceleration factor must be greater than zero.");
        if (request.ToolChangeTimeSec < 0)
            return BadRequest("Tool change time must be zero or greater.");

        profile.RapidRateMmpm = request.RapidRateMmpm;
        profile.SpindlePowerKw = request.SpindlePowerKw;
        profile.AccelDecelFactor = request.AccelDecelFactor;
        profile.ToolChangeTimeSec = request.ToolChangeTimeSec;
        profile.CreatedBy = createdBy;
        profile.CreatedDate = createdDate;
        profile.Status = status;

        await db.SaveChangesAsync();
        return profile.ToDto();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var profile = await db.MachineProfiles.FindAsync(id);
        if (profile == null) return NotFound();

        db.MachineProfiles.Remove(profile);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static string NormalizeStatus(string? status)
    {
        var s = (status ?? "").Trim();
        if (s.Equals("inactive", StringComparison.OrdinalIgnoreCase))
            return "Inactive";
        return "Active";
    }
}
